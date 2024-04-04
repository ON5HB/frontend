
import getColormap, { computeColormapArray } from './lib/colormaps.js'
import { JitterBuffer, createWaterfallDecoder } from './lib/wrappers.js'
import Denque from 'denque'
import 'core-js/actual/set-immediate'
import 'core-js/actual/clear-immediate'

export default class SpectrumWaterfall {
  constructor (endpoint, settings) {
    this.endpoint = endpoint

    this.spectrum = false
    this.waterfall = false

    this.waterfallQueue = new Denque(10)
    this.drawnWaterfallQueue = new Denque(4096)
    this.lagTime = 0
    this.spectrumAlpha = 0.5
    this.spectrumFiltered = [[-1, -1], [0]]

    this.waterfallColourShift = 130
    this.minWaterfall = -30
    this.maxWaterfall = 110
    // https://gist.github.com/mikhailov-work/ee72ba4191942acecc03fe6da94fc73f
    this.colormap = []

    this.setColormap('gqrx')

    this.clients = {}
    this.clientColormap = computeColormapArray(getColormap('rainbow'))

    this.updateTimeout = setTimeout(() => {}, 0)

    this.lineResets = 0

    this.bands = [
      { name: '80M HAM', startFreq: 3500000, endFreq: 3900000, color: 'rgba(50, 168, 72, 0.3)' },
      { name: '49M AM', startFreq: 5900000, endFreq: 6200000, color: 'rgba(199, 12, 193, 0.3)' },
      { name: '40M HAM', startFreq: 7000000, endFreq: 7200000, color: 'rgba(50, 78, 168, 0.3)' }, 
      { name: '41M AM', startFreq: 7200000, endFreq: 7450000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '31M AM', startFreq: 9400000, endFreq: 9900000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '30M HAM', startFreq: 10100000, endFreq: 10150000, color: 'rgba(199, 49, 12, 0.3)' }, 
      { name: '25M AM', startFreq: 11600000, endFreq: 12100000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '22M AM', startFreq: 13570000, endFreq: 13870000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '20M HAM', startFreq: 14000000, endFreq: 14350000, color: 'rgba(255, 0, 0, 0.3)' }, 
      { name: '19M AM', startFreq: 15100000, endFreq: 15800000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '16M AM', startFreq: 17480000, endFreq: 17900000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '17M AM', startFreq: 18068000, endFreq: 18168000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '15M AM', startFreq: 18900000, endFreq: 19020000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '15M HAM', startFreq: 21000000, endFreq: 21450000, color: 'rgba(6, 204, 214, 0.3)' }, 
      { name: '13M AM', startFreq: 21450000, endFreq: 21850000, color: 'rgba(199, 12, 193, 0.3)' }, 
      { name: '12M HAM', startFreq: 24890000, endFreq: 24990000, color: 'rgba(2, 155, 250, 0.3)' }, 
      { name: '11M AM', startFreq: 25670000, endFreq: 26100000, color: 'rgba(199, 12, 193, 0.3)' },
      { name: 'CB', startFreq: 26965000, endFreq: 27405000, color: 'rgba(3, 227, 252, 0.3)' },  
      { name: '10M HAM', startFreq: 28000000, endFreq: 29700000, color: 'rgba(151, 2, 250, 0.3)' }, 
      

    ];

    
  }

  initCanvas (settings) {
    this.canvasElem = settings.canvasElem
    this.ctx = this.canvasElem.getContext('2d')
    this.ctx.imageSmoothingEnabled = false
    this.canvasWidth = this.canvasElem.width
    this.canvasHeight = this.canvasElem.height
    this.backgroundColor = window.getComputedStyle(document.body, null).getPropertyValue('background-color')

    this.curLine = this.canvasHeight / 2

    this.ctx.fillStyle = this.backgroundColor
    this.ctx.fillRect(0, 0, this.canvasElem.width, this.canvasElem.height)

    this.graduationCanvasElem = settings.graduationCanvasElem
    this.graduationCtx = this.graduationCanvasElem.getContext('2d')

    this.spectrumCanvasElem = settings.spectrumCanvasElem
    this.spectrumCtx = this.spectrumCanvasElem.getContext('2d')

    this.spectrumCanvasElem.addEventListener('mousemove', this.spectrumMouseMove.bind(this))
    this.spectrumCanvasElem.addEventListener('mouseleave', this.spectrumMouseLeave.bind(this))

    this.tempCanvasElem = settings.tempCanvasElem
    this.tempCtx = this.tempCanvasElem.getContext('2d')
    this.tempCanvasElem.height = 200

    this.waterfall = true

    let resizeTimeout;
    let resizeCallback = () => {
      // Create a new canvas and copy over new canvas
      let resizeCanvas = document.createElement('canvas')
      resizeCanvas.width = this.canvasElem.width
      resizeCanvas.height = this.canvasElem.height
      let resizeCtx = resizeCanvas.getContext('2d')
      resizeCtx.drawImage(this.canvasElem, 0, 0)

      this.setCanvasWidth()
      this.curLine = Math.ceil(this.curLine * this.canvasElem.height / resizeCanvas.height)
      // Copy resizeCanvas to new canvas with scaling
      this.ctx.drawImage(resizeCanvas, 0, 0, resizeCanvas.width, resizeCanvas.height, 0, 0, this.canvasElem.width, this.canvasElem.height)
      this.updateGraduation()
      //this.redrawWaterfall()
      resizeTimeout = undefined
    }
    window.addEventListener('resize', () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      resizeCallback()
      resizeTimeout = setTimeout(resizeCallback, 250)
    })
  }

  async init () {
    if (this.promise) {
      return this.promise
    }

    this.waterfallSocket = new WebSocket(this.endpoint)
    this.waterfallSocket.binaryType = 'arraybuffer'
    this.firstWaterfallMessage = true
    this.waterfallSocket.onmessage = this.socketMessageInitial.bind(this)

    this.promise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })

    return this.promise
  }

  stop () {
    this.waterfallSocket.close()
  }

  setCanvasWidth() {
    let canvasWidth = window.screen.width * window.devicePixelRatio

    this.canvasElem.width = canvasWidth

    this.canvasScale = canvasWidth / 1024

    // Aspect ratio is 1024 to 128px
    this.spectrumCanvasElem.width = canvasWidth
    this.spectrumCanvasElem.height = canvasWidth / 1024 * 128

    // Aspect ratio is 1024 to 20px
    this.graduationCanvasElem.width = canvasWidth
    this.graduationCanvasElem.height = canvasWidth / 1024 * 20

    //this.canvasElem.height = window.outerHeight * window.devicePixelRatio * 2
    this.canvasElem.height = 100 * window.devicePixelRatio * 2
    this.canvasWidth = this.canvasElem.width
    this.canvasHeight = this.canvasElem.height
  }

  socketMessageInitial (event) {
    // First message gives the parameters in json
    if (!(event.data instanceof ArrayBuffer)) {
      const settings = JSON.parse(event.data)
      if (!settings.fft_size) {
        return
      }
      this.waterfallMaxSize = settings.fft_result_size
      this.fftSize = settings.fft_size
      this.baseFreq = settings.basefreq
      this.sps = settings.sps
      this.totalBandwidth = settings.total_bandwidth
      this.overlap = settings.overlap

      this.setCanvasWidth()
      this.tempCanvasElem.width = settings.waterfall_size * 2

      this.ctx.fillStyle = this.backgroundColor
      this.ctx.fillRect(0, 0, this.canvasElem.width, this.canvasElem.height)

      const skipNum = Math.max(1, Math.floor((this.sps / this.fftSize) / 10.0) * 2)
      const waterfallFPS = (this.sps / this.fftSize) / (skipNum / 2)
      //this.waterfallQueue = new JitterBuffer(1000 / waterfallFPS)
      
      console.log('Waterfall FPS: ' + waterfallFPS)

      this.waterfallDrawInterval = setInterval(() => {
        //requestAnimationFrame(this.drawSpectrogram.bind(this))
        this.drawSpectrogram()
      }, 1000 / waterfallFPS)

      this.waterfallL = 0
      this.waterfallR = this.waterfallMaxSize
      this.waterfallSocket.onmessage = this.socketMessage.bind(this)
      this.firstWaterfallMessage = false

      this.waterfallDecoder = createWaterfallDecoder(settings.waterfall_compression)
      this.updateGraduation()
      this.resolvePromise(settings)
    }
  }

  socketMessage (event) {
    if (event.data instanceof ArrayBuffer) {
      this.enqueueSpectrogram(event.data)
    }
  }

  getMouseX (canvas, evt) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width

    return (evt.clientX - rect.left) * scaleX
  }
  
  enqueueSpectrogram (array) {
    
    // Decode and extract header
    this.waterfallDecoder.decode(array).forEach((waterfallArray) => {
      this.waterfallQueue.unshift(waterfallArray)
    })

    // Do draw if not requested
    if (!this.waterfall && !this.spectrum) {
      this.waterfallQueue.clear()
      return
    }

    while (this.waterfallQueue.length > 2) {
      this.waterfallQueue.pop()
    }
  }

  //transformValue (x) {
  //  return Math.min(Math.max(x + this.waterfallColourShift, 0), 255)
  //}
  transformValue(value) {
      // Clamp value between minValue and maxValue
      let clampedValue = Math.max(this.minWaterfall, Math.min(this.maxWaterfall, value));
      
      // Normalize to 0-1 based on min and max settings
      let normalizedValue = (clampedValue - this.minWaterfall) / (this.maxWaterfall - this.minWaterfall);
      
      // Scale normalized value to colormap range (0-255)
      let colormapIndex = Math.floor(normalizedValue * 255);
      
      // Ensure index is within the bounds of the colormap array
      return Math.max(0, Math.min(255, colormapIndex));
  }


  // Helper functions

  idxToFreq (idx) {
    return idx / this.waterfallMaxSize * this.totalBandwidth + this.baseFreq
  }

  idxToCanvasX (idx) {
    return (idx - this.waterfallL) / (this.waterfallR - this.waterfallL) * this.canvasWidth
  }

  canvasXtoFreq (x) {
    const idx = x / this.canvasWidth * (this.waterfallR - this.waterfallL) + this.waterfallL
    return this.idxToFreq(idx)
  }

  freqToIdx (freq) {
    return (freq - this.baseFreq) / (this.totalBandwidth) * this.waterfallMaxSize
  }

  // Drawing functions
  calculateOffsets (waterfallArray, curL, curR) {
    // Correct for zooming or shifting
    const pxPerIdx = this.canvasWidth / (this.waterfallR - this.waterfallL)
    const pxL = (curL - this.waterfallL) * pxPerIdx
    const pxR = (curR - this.waterfallL) * pxPerIdx

    const arr = new Uint8Array(waterfallArray.length)
    for (let i = 0; i < arr.length; i++) {
      arr[i] = this.transformValue(waterfallArray[i])
    }
    return [arr, pxL, pxR]
  }

  drawSpectrogram () {
    
    if (this.waterfallQueue.length === 0) {
      return
    }

    const {data: waterfallArray, l: curL, r: curR} = this.waterfallQueue.pop()
    
    const [arr, pxL, pxR] = this.calculateOffsets(waterfallArray, curL, curR)
    
    if (this.waterfall) {
      this.drawWaterfall(arr, pxL, pxR, curL, curR)
    }
    if (this.spectrum) {
      this.drawSpectrum(arr, pxL, pxR, curL, curR)
    }

    this.drawnWaterfallQueue.unshift([waterfallArray, curL, curR])

    if (this.drawnWaterfallQueue.length > this.canvasHeight) {
      this.drawnWaterfallQueue.pop()
    }
  }

  async redrawWaterfall () {
    return;
    const toDraw = this.drawnWaterfallQueue.toArray()
    const curLineReset = this.lineResets
    const curLine = this.curLine
    const drawLine = (i) => {
      const toDrawLine = curLine + 1 + i + (this.lineResets - curLineReset) * this.canvasHeight / 2

      const [waterfallArray, curL, curR] = toDraw[i]

      const [arr, pxL, pxR] = this.calculateOffsets(waterfallArray, curL, curR)
      
      this.drawWaterfallLine(arr, pxL, pxR, toDrawLine)
      if (i + 1 < toDraw.length) {
        this.updateImmediate = setImmediate(() => drawLine(i + 1))
      }
    }
    clearImmediate(this.updateImmediate)
    if (toDraw.length) {
      drawLine(0)
    }
  }

  drawWaterfallLine(arr, pxL, pxR, line) {
    // Draw the new line
    const colorarr = this.ctx.createImageData(arr.length, 1);
  
    for (let i = 0; i < arr.length; i++) {
      

      colorarr.data.set(this.colormap[arr[i]], i * 4);
    }
  
    this.tempCtx.putImageData(colorarr, 0, 0);
    // Resize the line into the correct width
    this.ctx.drawImage(this.tempCanvasElem, 0, 0, arr.length, 1, pxL, line, pxR - pxL, 1);
  }
  
  drawWaterfall(arr, pxL, pxR, curL, curR) {
    // Copy the current canvas content and shift it down by one pixel
    const imageData = this.ctx.getImageData(0, 0, this.canvasWidth, this.canvasHeight - 1);
    this.ctx.putImageData(imageData, 0, 1);
  
    // The current line is now effectively shifted down by one, so draw the new line at the top
    this.drawWaterfallLine(arr, pxL, pxR, 0);
  
    // No need for CSS transform or tracking curLine for shifting content
  }
  
  drawSpectrum (arr, pxL, pxR, curL, curR) {
    if (curL !== this.spectrumFiltered[0][0] || curR !== this.spectrumFiltered[0][1]) {
      this.spectrumFiltered[1] = arr
      this.spectrumFiltered[0] = [curL, curR]
    }

    // Smooth the spectrogram with the previous values
    for (let i = 0; i < arr.length; i++) {
      this.spectrumFiltered[1][i] = this.spectrumAlpha * arr[i] + (1 - this.spectrumAlpha) * this.spectrumFiltered[1][i]
    }

    // Take the smoothed value
    arr = this.spectrumFiltered[1]

    const pixels = (pxR - pxL) / arr.length
    let scale = this.canvasScale

    arr = arr.map((x) => 255 - x)

    // Blank the screen
    this.spectrumCtx.clearRect(0, 0, this.spectrumCanvasElem.width, this.spectrumCanvasElem.height)
    this.spectrumCtx.strokeStyle = 'yellow'
    this.spectrumCtx.fillStyle = 'yellow'

    // Draw the line
    this.spectrumCtx.beginPath()
    this.spectrumCtx.moveTo(pxL, arr[0] / 2 * scale)
    arr.forEach((x, i) => {
      this.spectrumCtx.lineTo(pxL + pixels / 2 + i * pixels, x / 2 * scale)
    })
    this.spectrumCtx.lineTo(pxR, arr[arr.length - 1] / 2 * scale)
    this.spectrumCtx.stroke()

    if (this.spectrumFreq) {
      this.spectrumCtx.fillText((this.spectrumFreq / 1e6).toFixed(8) + ' MHz', 10, 10)
      this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      this.spectrumCtx.beginPath()
      this.spectrumCtx.moveTo(this.spectrumX, 0)
      this.spectrumCtx.lineTo(this.spectrumX, 128 * scale)
      this.spectrumCtx.stroke()
    }
  }

  updateGraduation () {
    const freqL = this.idxToFreq(this.waterfallL)
    const freqR = this.idxToFreq(this.waterfallR)
    const scale = this.canvasScale

    let graduationSpacing = 1

    // Calculate the scale where at least 20 graduation spacings will be drawn
    while ((freqR - freqL) / graduationSpacing > 8) {
      graduationSpacing *= 10
    }
    graduationSpacing /= 10

    this.graduationCtx.fillStyle = 'white'
    this.graduationCtx.strokeStyle = 'white'
    this.graduationCtx.clearRect(0, 0, this.graduationCanvasElem.width, this.graduationCanvasElem.height)

    // Find the first graduation frequency
    let freqLStart = freqL
    if (freqL % graduationSpacing !== 0) {
      freqLStart = freqL + (graduationSpacing - (freqL % graduationSpacing))
    }

    // Find the least amount of trailing zeros
    let minimumTrailingZeros = 5
    for (let freqStart = freqLStart; freqStart <= freqR; freqStart += graduationSpacing) {
      if (freqStart != 0) {
        const trailingZeros = freqStart.toString().match(/0*$/g)[0].length
        minimumTrailingZeros = Math.min(minimumTrailingZeros, trailingZeros)
      }
    }
    
    this.graduationCtx.font = `${10 * scale}px Arial`
    for (; freqLStart <= freqR; freqLStart += graduationSpacing) {
      // find the middle pixel
      const middlePixel = (freqLStart - freqL) / (freqR - freqL) * this.canvasWidth

      let lineHeight = 5
      let printFreq = false
      if (freqLStart % (graduationSpacing * 10) === 0) {
        lineHeight = 10
        printFreq = true
      } else if (freqLStart % (graduationSpacing * 5) === 0) {
        lineHeight = 7
        printFreq = true
      }

      if (printFreq) {
        this.graduationCtx.textAlign = 'center'
        this.graduationCtx.fillText((freqLStart / 1000000).toFixed(6 - minimumTrailingZeros) + ' MHz', middlePixel, 7.5 * scale)
      }
      // draw a line in the middle of it
      this.graduationCtx.lineWidth = 1 * scale
      this.graduationCtx.beginPath()
      this.graduationCtx.moveTo(middlePixel, (10 + (10 - lineHeight)) * scale)
      this.graduationCtx.lineTo(middlePixel, (20) * scale)
      this.graduationCtx.stroke()
    }

    // Define the height of the band marker rectangle
    const bandHeight = 12; // Example height, adjust as needed

    // Loop through each band and draw it
    this.bands.forEach(band => {
      const startIdx = this.freqToIdx(band.startFreq);
      const endIdx = this.freqToIdx(band.endFreq);
      const startX = this.idxToCanvasX(startIdx);
      const endX = this.idxToCanvasX(endIdx);
      const bandWidth = endX - startX;

      // Draw the band range as a rectangle
      this.graduationCtx.fillStyle = band.color;
      this.graduationCtx.fillRect(startX, this.graduationCanvasElem.height - bandHeight, bandWidth, bandHeight);

      // Dynamically calculate font size based on the width of the band marker
      let fontSize = Math.max(Math.min(bandWidth / band.name.length, 10), 4);


      // Set the font for the band label
      this.graduationCtx.fillStyle = 'white';
      this.graduationCtx.font = `${fontSize}px Arial`;
      this.graduationCtx.textAlign = 'center';

      // Ensure the font size is such that the text will fit within the rectangle
      if (this.graduationCtx.measureText(band.name).width < bandWidth) {
        // Draw the text centered within the band marker rectangle
        this.graduationCtx.fillText(band.name, (startX + endX) / 2, this.graduationCanvasElem.height - bandHeight / 2 + fontSize / 3);
      } else {
        // If the text does not fit, we could scale down the font size until it does or skip drawing the label
        // This is a simple loop to decrease font size until the text fits
        while (this.graduationCtx.measureText(band.name).width >= bandWidth && fontSize > 6) {
          fontSize--;
          this.graduationCtx.font = `${fontSize}px Arial`;
        }
        if (fontSize > 4) { // Check again if text fits after resizing, then draw it
          this.graduationCtx.fillText(band.name, (startX + endX) / 2, this.graduationCanvasElem.height - bandHeight / 2 + fontSize / 3);
        }
      }
    });

    this.drawClients()
  }

  setClients (clients) {
    this.clients = clients
  }

  drawClients () {
    Object.entries(this.clients)
      .filter(([_, x]) => (x[1] < this.waterfallR && x[1] >= this.waterfallL))
      .forEach(([id, range]) => {
        const midOffset = this.idxToCanvasX(range[1])
        const [r, g, b, a] = this.clientColormap[parseInt(id.substring(0, 2), 16)]
        this.graduationCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`
        this.graduationCtx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a})`
        this.graduationCtx.beginPath()
        this.graduationCtx.moveTo(midOffset, 0)
        this.graduationCtx.lineTo(midOffset + 2, 5)
        this.graduationCtx.stroke()
        this.graduationCtx.beginPath()
        this.graduationCtx.moveTo(midOffset, 0)
        this.graduationCtx.lineTo(midOffset - 2, 5)
        this.graduationCtx.stroke()
        // this.graduationCtx.arc(midOffset, 2, 2, 0, 2 * Math.PI, 0)
        // this.graduationCtx.fill()
      })
  }

  setWaterfallRange (waterfallL, waterfallR) {
    if (waterfallL >= waterfallR) {
      return
    }
    const width = waterfallR - waterfallL
    // If there is out of bounds, fix the bounds
    if (waterfallL < 0 && waterfallR > this.waterfallMaxSize) {
      waterfallL = 0
      waterfallR = this.waterfallMaxSize
    } else if (waterfallL < 0) {
      waterfallL = 0
      waterfallR = width
    } else if (waterfallR > this.waterfallMaxSize) {
      waterfallR = this.waterfallMaxSize
      waterfallL = waterfallR - width
    }
    const prevL = this.waterfallL
    const prevR = this.waterfallR
    this.waterfallL = waterfallL
    this.waterfallR = waterfallR
    this.waterfallSocket.send(JSON.stringify({
      cmd: 'window',
      l: this.waterfallL,
      r: this.waterfallR
    }))

    const newCanvasX1 = this.idxToCanvasX(prevL)
    const newCanvasX2 = this.idxToCanvasX(prevR)
    const newCanvasWidth = newCanvasX2 - newCanvasX1

    this.ctx.drawImage(this.canvasElem, 0, 0, this.canvasWidth, this.canvasHeight, newCanvasX1, 0, newCanvasWidth, this.canvasHeight)

    // Special case for zoom out or panning, blank the borders
    if ((prevR - prevL) <= (waterfallR - waterfallL) + 1) {
      this.ctx.fillStyle = this.backgroundColor
      this.ctx.fillRect(0, 0, newCanvasX1, this.canvasHeight)
      this.ctx.fillRect(newCanvasX2, 0, this.canvasWidth - newCanvasX2, this.canvasHeight)
    }
    this.updateGraduation()
    //this.resetRedrawTimeout(500)
  }

  getWaterfallRange () {
    return [this.waterfallL, this.waterfallR]
  }

  setWaterfallLagTime (lagTime) {
    this.lagTime = Math.max(0, lagTime)
  }

  setOffset (offset) {
    this.waterfallColourShift = offset
    //this.resetRedrawTimeout(100)
  }
  setMinOffset (offset) {
    this.minWaterfall = offset
    //this.resetRedrawTimeout(100)
  }
  setMaxOffset (offset) {
    this.maxWaterfall = offset
    //this.resetRedrawTimeout(100)
  }

  setAlpha (alpha) {
    this.spectrumAlpha = alpha
  }

  setColormapArray (colormap) {
    this.colormap = computeColormapArray(colormap)
  }

  setColormap (name) {
    this.setColormapArray(getColormap(name))
    //this.resetRedrawTimeout(50)
  }

  setUserID (userID) {
    this.waterfallSocket.send(JSON.stringify({
      cmd: 'userid',
      userid: userID
    }))
  }

  setSpectrum (spectrum) {
    this.spectrum = spectrum
  }

  setWaterfall (waterfall) {
    this.waterfall = waterfall
  }

  resetRedrawTimeout (timeout) {
    return;
    if (this.updateTimeout !== undefined) {
      clearTimeout(this.updateTimeout)
    }
    this.updateTimeout = setTimeout(this.redrawWaterfall.bind(this), timeout)
  }

  canvasWheel (e) {
    // For UI to pass custom zoom range
    const x = (e.coords || { x: this.getMouseX(this.spectrumCanvasElem, e) }).x
    e.preventDefault()

    const zoomAmount = e.deltaY || e.scale
    const l = this.waterfallL
    const r = this.waterfallR
    // For UI to pass in a custom scale amount
    const scale = e.scaleAmount || 0.85

    // Prevent zooming beyond a certain point
    if (r - l <= 128 && zoomAmount < 0) {
      return false
    }
    const centerfreq = (r - l) * x / this.canvasWidth + l
    let widthL = centerfreq - l
    let widthR = r - centerfreq
    if (zoomAmount < 0) {
      widthL *= scale
      widthR *= scale
    } else if (zoomAmount > 0) {
      widthL *= 1 / scale
      widthR *= 1 / scale
    }
    const waterfallL = Math.round(centerfreq - widthL)
    const waterfallR = Math.round(centerfreq + widthR)

    this.setWaterfallRange(waterfallL, waterfallR)

    return false
  }

  mouseMove (e) {
    // Clear the waterfall queue to remove old data
    this.waterfallQueue.clear();
    // Figure out how much is dragged
    const mouseMovement = e.movementX
    const frequencyMovement = Math.round(mouseMovement / this.canvasElem.getBoundingClientRect().width * (this.waterfallR - this.waterfallL))

    if (!frequencyMovement) {
      return
    }
    const newL = this.waterfallL - frequencyMovement
    const newR = this.waterfallR - frequencyMovement
    this.setWaterfallRange(newL, newR)
  }

  spectrumMouseMove (e) {
    const x = this.getMouseX(this.spectrumCanvasElem, e)
    const freq = this.canvasXtoFreq(x)
    this.spectrumFreq = freq
    this.spectrumX = x
  }

  spectrumMouseLeave (e) {
    this.spectrumFreq = undefined
    this.spectrumX = undefined
  }
}