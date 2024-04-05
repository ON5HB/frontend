import { createDecoder, firdes_kaiser_lowpass } from './lib/wrappers'

import createWindow from 'live-moving-average'
import { decode as cbor_decode } from 'cbor-x';
import { encode, decode } from "./modules/ft8.js";

import { AudioContext, ConvolverNode, IIRFilterNode, GainNode, AudioBuffer, AudioBufferSourceNode } from 'standardized-audio-context'

export default class SpectrumAudio {
  constructor(endpoint) {
    this.endpoint = endpoint

    this.playAmount = 0

    this.playMovingAverage = []
    this.playSampleLength = 1
    this.audioQueue = []

    this.demodulation = 'USB'

    // Decoders
    this.accumulator = [];
    this.decodeFT8 = false;
    this.farthestDistance = 0;

    // Audio controls
    this.mute = false
    this.squelchMute = false
    this.squelch = false
    this.squelchThreshold = 0
    this.power = 1

    // for chrome
    const userGestureFunc = () => {
      if (this.audioCtx && this.audioCtx.state !== 'running') {
        this.audioCtx.resume()
      }
      // Remove the element with id startaudio from the DOM
      const startaudio = document.getElementById('startaudio')
      if (startaudio) {
        startaudio.remove()
      }
      document.documentElement.removeEventListener('mousedown', userGestureFunc)
    }
    document.documentElement.addEventListener('mousedown', userGestureFunc)

    this.mode = 0
    this.d = 10
    this.v = 10
    this.n2 = 10
    this.n1 = 10
    this.var = 10
    this.highThres = 1

    this.initTimer(); // Start the timing mechanism
  }

  async init() {
    if (this.promise) {
      return this.promise
    }

    this.promise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })

    this.audioSocket = new WebSocket(this.endpoint)
    this.audioSocket.binaryType = 'arraybuffer'
    this.firstAudioMessage = true
    this.audioSocket.onmessage = this.socketMessageInitial.bind(this)

    return this.promise
  }

  stop() {
    this.audioSocket.close()
    this.decoder.free()
  }

  initAudio(settings) {
    const sampleRate = this.audioOutputSps
    try {
      this.audioCtx = new AudioContext({
        sampleRate: sampleRate
      })
    } catch {
      this.resolvePromise()
      return
    }

    this.audioStartTime = this.audioCtx.currentTime
    this.playTime = this.audioCtx.currentTime + 0.1
    this.playStartTime = this.audioCtx.currentTime

    this.decoder = createDecoder(settings.audio_compression, this.audioMaxSps, this.trueAudioSps, this.audioOutputSps)
    
    // inputNode -> fmDeemphNode -> convolverNode -> gainNode -> audioCtx.destination

    this.gainNode = new GainNode(this.audioCtx)
    this.setGain(10)
    this.gainNode.connect(this.audioCtx.destination)

    this.convolverNode = new ConvolverNode(this.audioCtx)
    this.setLowpass(15000)
    this.convolverNode.connect(this.gainNode)

    this.hpfilter = this.audioCtx.createBiquadFilter();
    this.hpfilter.type = "highpass";
    this.hpfilter.frequency.value = 50; 
    this.hpfilter.connect(this.convolverNode)


    this.audioInputNode = this.hpfilter

    // this.wbfmStereo = new LiquidDSP.WBFMStereo(this.trueAudioSps)

    this.resolvePromise(settings)
  }

  setFIRFilter(fir) {
    const firAudioBuffer = new AudioBuffer({ length: fir.length, numberOfChannels: 1, sampleRate: this.audioOutputSps })
    firAudioBuffer.copyToChannel(fir, 0, 0)
    this.convolverNode.buffer = firAudioBuffer
  }

  setLowpass(lowpass) {
    const sampleRate = this.audioOutputSps
    // Bypass the FIR filter if the sample rate is low enough
    if (lowpass >= sampleRate / 2) {
      this.setFIRFilter(Float32Array.of(1))
      return
    }
    const fir = firdes_kaiser_lowpass(lowpass / sampleRate, 1000 / sampleRate, 0.001)
    this.setFIRFilter(fir)
  }

  setFT8Decoding(value)
  {
    this.decodeFT8 = value;
  }

  setFmDeemph(tau) {
    if (tau === 0) {
      this.audioInputNode = this.convolverNode
      return
    }
    // FM deemph https://github.com/gnuradio/gnuradio/blob/master/gr-analog/python/analog/fm_emph.py
    // Digital corner frequency
    const wc = 1.0 / tau
    const fs = this.audioOutputSps

    // Prewarped analog corner frequency
    const wca = 2.0 * fs * Math.tan(wc / (2.0 * fs))

    // Resulting digital pole, zero, and gain term from the bilinear
    // transformation of H(s) = w_ca / (s + w_ca) to
    // H(z) = b0 (1 - z1 z^-1)/(1 - p1 z^-1)
    const k = -wca / (2.0 * fs)
    const z1 = -1.0
    const p1 = (1.0 + k) / (1.0 - k)
    const b0 = -k / (1.0 - k)

    const feedForwardTaps = [b0 * 1.0, b0 * -z1]
    const feedBackwardTaps = [1.0, -p1]

    this.fmDeemphNode = new IIRFilterNode(this.audioCtx, { feedforward: feedForwardTaps, feedback: feedBackwardTaps })
    this.fmDeemphNode.connect(this.convolverNode)

    this.audioInputNode = this.fmDeemphNode
  }

  socketMessageInitial(event) {
    // first message gives the parameters in json
    const settings = JSON.parse(event.data)
    this.settings = settings
    this.fftSize = settings.fft_size
    this.audioMaxSize = settings.fft_result_size
    this.baseFreq = settings.basefreq
    this.totalBandwidth = settings.total_bandwidth
    this.sps = settings.sps
    this.audioOverlap = settings.fft_overlap / 2
    this.audioMaxSps = settings.audio_max_sps
    this.grid_locator = settings.grid_locator

    this.audioL = settings.defaults.l
    this.audioM = settings.defaults.m
    this.audioR = settings.defaults.r

    const targetFFTBins = Math.ceil(this.audioMaxSps * this.audioMaxSize / this.sps / 4) * 4

    this.trueAudioSps = targetFFTBins / this.audioMaxSize * this.sps
    this.audioOutputSps = Math.min(this.audioMaxSps, 96000)

    this.audioSocket.onmessage = this.socketMessage.bind(this)

    this.initAudio(settings)

    console.log('Audio Samplerate: ', this.trueAudioSps)
  }

  socketMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      const packet = cbor_decode(new Uint8Array(event.data))
      const receivedPower = packet.pwr
      this.power = 0.5 * this.power + 0.5 * receivedPower || 1
      const dBpower = 20 * Math.log10(Math.sqrt(this.power) / 2)
      this.dBPower = dBpower
      if (this.squelch && dBpower < this.squelchThreshold) {
        this.squelchMute = true
      } else {
        this.squelchMute = false
      }

      this.decode(packet.data)
    }
  }

  decode(encoded) {
    // Audio not available
    if (!this.audioCtx) {
      return
    }
    let pcmArray = this.decoder.decode(encoded)
    // More samples needed
    if (pcmArray.length === 0) {
      return
    }

    this.intervals = this.intervals || createWindow(10000, 0)
    this.lens = this.lens || createWindow(10000, 0)
    this.lastReceived = this.lastReceived || 0
    // For checking sample rate
    if (this.lastReceived === 0) {
      this.lastReceived = performance.now()
    } else {
      const curReceived = performance.now()
      const delay = curReceived - this.lastReceived
      this.intervals.push(delay)
      this.lastReceived = curReceived
      this.lens.push(pcmArray.length)

      let updatedv = true

      if (this.mode === 0) {
        if (Math.abs(delay - this.n1) > Math.abs(this.v) * 2 + 800) {
          this.var = 0
          this.mode = 1
        }
      } else {
        this.var = this.var / 2 + Math.abs((2 * delay - this.n1 - this.n2) / 8)
        if (this.var <= 63) {
          this.mode = 0
          updatedv = false
        }
      }

      if (updatedv) {
        if (this.mode === 0) {
          this.d = 0.125 * delay + 0.875 * this.d
        } else {
          this.d = this.d + delay - this.n1
        }
        this.v = 0.125 * Math.abs(delay - this.d) + 0.875 * this.v
      }

      this.n2 = this.n1
      this.n1 = delay
    }

    this.pcmArray = pcmArray
    if (this.signalDecoder) {
      this.signalDecoder.decode(pcmArray)
    }

    this.playAudio(pcmArray)
  }

  updateAudioParams() {
    this.audioSocket.send(JSON.stringify({
      cmd: 'window',
      l: this.audioL,
      m: this.audioM,
      r: this.audioR
    }))
  }

  setAudioDemodulation(demodulation) {
    this.demodulation = demodulation
    this.audioSocket.send(JSON.stringify({
      cmd: 'demodulation',
      demodulation: demodulation
    }))
  }

  setAudioRange(audioL, audioM, audioR) {
    this.audioL = Math.floor(audioL)
    this.audioM = audioM
    this.audioR = Math.ceil(audioR)
    this.actualL = audioL
    this.actualR = audioR
    this.updateAudioParams()
  }

  getAudioRange() {
    return [this.actualL, this.audioM, this.actualR]
  }

  setAudioOptions(options) {
    this.audioOptions = options
    this.audioSocket.send(JSON.stringify({
      cmd: 'options',
      options: options
    }))
  }

  setGain(gain) {
    this.gain = gain
    this.gainNode.gain.value = gain
  }

  setMute(mute) {
    if (mute === this.mute) {
      return
    }
    this.mute = mute
    this.audioSocket.send(JSON.stringify({
      cmd: 'mute',
      mute: mute
    }))
  }

  setSquelch(squelch) {
    this.squelch = squelch
  }

  setSquelchThreshold(squelchThreshold) {
    this.squelchThreshold = squelchThreshold
  }

  getPowerDb() {
    return this.dBPower
  }

  setUserID(userID) {
    this.audioSocket.send(JSON.stringify({
      cmd: 'userid',
      userid: userID
    }))
  }

  setSignalDecoder(decoder) {
    this.signalDecoder = decoder
  }

  getSignalDecoder() {
    return this.signalDecoder
  }


  // FT8 Start


  gridSquareToLatLong(gridSquare) {
      const l = gridSquare.toUpperCase();
      let lon = ((l.charCodeAt(0) - 'A'.charCodeAt(0)) * 20) - 180;
      let lat = ((l.charCodeAt(1) - 'A'.charCodeAt(0)) * 10) - 90;
      lon += ((l.charCodeAt(2) - '0'.charCodeAt(0)) * 2);
      lat += (l.charCodeAt(3) - '0'.charCodeAt(0));
      lon += ((l.charCodeAt(4) - 'A'.charCodeAt(0)) * (5 / 60));
      lat += ((l.charCodeAt(5) - 'A'.charCodeAt(0)) * (2.5 / 60));
      lon += (5 / 120); // center of the square
      lat += (1.25 / 120); // center of the square
      return [lat, lon];
  }

  initTimer() {
    // Check every second to adjust the collecting status based on current time
    setInterval(() => {
      this.updateCollectionStatus();
    }, 1000);
  }

  // For FT8
  extractGridLocators(message) {
    // Regular expression for matching grid locators
    const regex = /[A-R]{2}[0-9]{2}([A-X]{2})?/gi;
    
    // Find matches in the provided message
    const matches = message.match(regex);
    
    // Ensure unique matches, as the same locator might appear more than once
    const uniqueLocators = matches ? Array.from(new Set(matches)) : [];
    
    return uniqueLocators;
  }


  calculateDistance(lat1, lon1, lat2, lon2) {
    function toRad(x) {
      return x * Math.PI / 180;
    }
  
    var R = 6371; // km
    var dLat = toRad(lat2-lat1);
    var dLon = toRad(lon2-lon1);
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    var d = R * c;
    return d;
  }
  
  


  updateCollectionStatus() {
    const now = new Date();
    const seconds = now.getSeconds();
    const waitSeconds = 15 - (seconds % 15);
    
    if (waitSeconds === 15 && !this.isCollecting) {
      this.startCollection();
    } else if (waitSeconds === 1 && this.isCollecting) {
      this.stopCollection();
    }
  }

  startCollection() {
    this.isCollecting = true;
    this.accumulator = []; // Reset the accumulator
  }

  async stopCollection() {
    this.isCollecting = false;
    if(this.decodeFT8) {
      const bigFloat32Array = new Float32Array(this.accumulator.flat());
      let decodedMessages = await decode(bigFloat32Array);
      const messagesListDiv = document.getElementById('ft8MessagesList');
  
      let baseLocation = this.gridSquareToLatLong(this.grid_locator);
  
      for (let message of decodedMessages) {
        let locators = this.extractGridLocators(message.text);
  
        if(locators.length > 0) {
          // Assuming the first locator is the target location
          let targetLocation = this.gridSquareToLatLong(locators[0]);
          let distance = this.calculateDistance(baseLocation[0], baseLocation[1], targetLocation[0], targetLocation[1]);

          if (distance > this.farthestDistance) {
            this.farthestDistance = distance;
            document.getElementById('farthest-distance').textContent = ` - Farthest Distance: ${this.farthestDistance.toFixed(2)} km`;
          }
  
          const messageDiv = document.createElement('div');
          messageDiv.classList.add('p-2', 'border-b', 'border-gray-800');
  
          let messageContent = `Message: ${message.text}`;
  
          messageContent += `, Locators: `;
  
          // Add the locator content before appending locator links
          const locatorsContent = document.createTextNode(messageContent);
          messageDiv.appendChild(locatorsContent);
  
          // Append locators as clickable links
          locators.forEach((locator, index) => {
            const locatorLink = document.createElement('a');
            locatorLink.href = `https://www.levinecentral.com/ham/grid_square.php?&Grid=${locator}&Zoom=13&sm=y`;
            locatorLink.style = "color:#ffdc00;"
            locatorLink.textContent = locator;
            locatorLink.target = "_blank"; // Open in new tab
            messageDiv.appendChild(document.createTextNode(index > 0 ? ', ' : ''));
            messageDiv.appendChild(locatorLink);
          });
  
          // Append distance information
          const distanceText = document.createTextNode(`, Distance: ${distance.toFixed(2)} km`);
          messageDiv.appendChild(distanceText);
  
          messagesListDiv.appendChild(messageDiv);
        }
      }
  
      setTimeout(() => {
        messagesListDiv.scrollTop = messagesListDiv.scrollHeight;
      }, 500);
    }
  }
  

  // FT8 END


  playAudio(pcmArray) {
    if (this.mute || (this.squelchMute && this.squelch)) {
      return
    }
    if (this.audioCtx.state !== 'running') {
      return
    }

    if (this.isCollecting && this.decodeFT8) {
      
      this.accumulator.push(...pcmArray); // Spread the array to flatten it upon insertion
    }

    const curPlayTime = this.playPCM(pcmArray, this.playTime, this.audioOutputSps, 1)

    // buffering issues
    if (this.playTime - this.audioCtx.currentTime <= curPlayTime) {
      this.playTime = this.audioCtx.currentTime + (this.d + 4 * this.v) / 1000
      console.log('underrun')
    } else if (this.playTime - this.audioCtx.currentTime > 2) {
      this.playTime = this.audioCtx.currentTime + (this.d + 4 * this.v) / 1000
      console.log('overrun')
    }
  }

  playPCM(buffer, playTime, sampleRate, scale) {
    // Wait for the audio to be initialised
    if (!this.audioInputNode) {
      return
    }
    const source = new AudioBufferSourceNode(this.audioCtx)

    const audioBuffer = new AudioBuffer({ length: buffer.length, numberOfChannels: 1, sampleRate: this.audioOutputSps })
    audioBuffer.copyToChannel(buffer, 0, 0)

    source.buffer = audioBuffer
    source.start(playTime)
    this.playTime += audioBuffer.duration

    source.connect(this.audioInputNode)

    return audioBuffer.duration
  }
}