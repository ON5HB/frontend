<script>
  import { onDestroy, onMount } from 'svelte'
  import copy from 'copy-to-clipboard'
  import { RollingMax } from 'efficient-rolling-stats'
  import { writable } from "svelte/store";

  import CheckButton from './lib/CheckButton.svelte'
  import LineThroughButton from './lib/LineThroughButton.svelte'
  import PassbandTuner from './lib/PassbandTuner.svelte'
  import FrequencyInput from './lib/FrequencyInput.svelte'
  import FrequencyMarkers from './lib/FrequencyMarkers.svelte'
  import Tooltip from './lib/Tooltip.svelte'
  import Popover from './lib/Popover.svelte'
  import Logger from './lib/Logger.svelte'

  import { pinch, pan } from './lib/hammeractions.js'
  import { availableColormaps, drawColormapPreview } from './lib/colormaps'
  import { init, audio, waterfall, events, FFTOffsetToFrequency, frequencyToFFTOffset, frequencyToWaterfallOffset, getMaximumBandwidth, waterfallOffsetToFrequency } from './lib/backend.js'
  import { constructLink, parseLink, storeInLocalStorage } from './lib/storage.js'

  let waterfallCanvas
  let spectrumCanvas
  let graduationCanvas
  let tempCanvas

  let frequencyInputComponent

  let passbandTunerComponent
  let bandwidth
  let link
  var chatContentDiv;

  let activeTab = 'audio'; // Default active tab

  function setActiveTab(tabName) {
    activeTab = tabName;
  }

  function generateUniqueId() {
    return Math.random().toString(36).substr(2, 10) + Math.random().toString(36).substr(2, 10);
  }

  let userId; // Global variable to store the user's unique ID

  



  
  
  // Updates the passband display
  function updatePassband (passband) {
    passband = passband || audio.getAudioRange()
    const frequencies = passband.map(FFTOffsetToFrequency)
    // Bandwidth display also needs updating
    bandwidth = ((frequencies[2] - frequencies[0]) / 1000).toFixed(2)
    // Passband Display
    const offsets = frequencies.map(frequencyToWaterfallOffset)
    passbandTunerComponent.changePassband(offsets)
  }
  // Wheel zooming, update passband and markers
  function handleWaterfallWheel (e) {
    waterfall.canvasWheel(e)
    passbandTunerComponent.updatePassbandLimits()
    updatePassband()
    frequencyMarkerComponent.updateFrequencyMarkerPositions()
  }

  // Decoder
  let ft8Enabled = false;

  // Handling dragging the waterfall left or right
  let waterfallDragging = false
  let waterfallDragTotal = 0
  let waterfallBeginX = 0
  function handleWaterfallMouseDown (e) {
    waterfallDragTotal = 0
    waterfallDragging = true
    waterfallBeginX = e.clientX
  }
  function handleWindowMouseMove (e) {
    if (waterfallDragging) {
      waterfallDragTotal += Math.abs(e.movementX) + Math.abs(e.movementY)
      waterfall.mouseMove(e)
      updatePassband()
      frequencyMarkerComponent.updateFrequencyMarkerPositions()
    }
  }
  function handleWindowMouseUp (e) {
    if (waterfallDragging) {
      // If mouseup without moving, handle as click
      if (waterfallDragTotal < 2) {
        passbandTunerComponent.handlePassbandClick(e)
      }
      waterfallDragging = false
    }
  }
  
  // Sidebar controls for waterfall and spectrum analyzer
  let waterfallDisplay = true
  let spectrumDisplay = true
  function handleSpectrumChange () {
    spectrumDisplay = !spectrumDisplay
    waterfall.setSpectrum(spectrumDisplay)
  }
  function handleWaterfallChange () {
    waterfall.setWaterfall(waterfallDisplay)
  }

  // Waterfall drawing
  let currentColormap = 'gqrx'
  let colormapPreview
  let alpha = 0.5
  let brightness = 130
  let min_waterfall = -30
  let max_waterfall = 110
  function handleWaterfallColormapSelect (event) {
    waterfall.setColormap(currentColormap)
    drawColormapPreview(currentColormap, colormapPreview)
  }

  // Waterfall slider controls
  function handleAlphaMove () {
    waterfall.setAlpha(1 - alpha)
  }
  function handleBrightnessMove () {
    waterfall.setOffset(brightness)
  }
  function handleMinMove () {
    waterfall.setMinOffset(min_waterfall)
  }
  function handleMaxMove () {
    waterfall.setMaxOffset(max_waterfall)
  }

  // Audio demodulation selection
  let demodulators = [
    'USB', 'LSB', 'CW-U', 'CW-L', 'AM', 'FM'
  ]
  const demodulationDefaults = {
    USB: { type: 'USB', offsets: [-190, 2800] },
    LSB: { type: 'LSB', offsets: [2800, -190] },
    'CW-U': { type: 'USB', offsets: [-500, 1000], bfo: -700 },
    'CW-L': { type: 'LSB', offsets: [1000, -500], bfo: 700 },
    AM: { type: 'AM', offsets: [5000, 5000] },
    FM: { type: 'FM', offsets: [5000, 5000] },
    WBFM: { type: 'FM', offsets: [95000, 95000] }
  }
  let demodulation = 'USB'
  function roundAudioOffsets (offsets) {
    const [l, m, r] = offsets
    return [
      Math.floor(l),
      m,
      Math.floor(r)
    ]
  }

  // Demodulation controls
  function handleDemodulationChange (e, changed) {
    const demodulationDefault = demodulationDefaults[demodulation]
    if (changed) {
      if (demodulation === 'WBFM') {
        audio.setFmDeemph(50e-6)
      } else {
        audio.setFmDeemph(0)
      }
      audio.setAudioDemodulation(demodulationDefault.type)
    }
    let prevBFO = frequencyInputComponent.getBFO()
    let newBFO = demodulationDefault.bfo || 0
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency)
    m = m + newBFO - prevBFO
    l = m - demodulationDefault.offsets[0]
    r = m + demodulationDefault.offsets[1]

    frequencyInputComponent.setBFO(newBFO)
    frequencyInputComponent.setFrequency()

    const audioParameters = [l, m, r].map(frequencyToFFTOffset)
    audio.setAudioRange(...audioParameters)
    updatePassband()
    updateLink()
  }

  function handleFt8Decoder(e, value)
  {
    ft8Enabled = value;
    audio.setFT8Decoding(value);
  }

  // Normalizes dB values to a 0-100 scale for visualization
  function normalizeDb(dbValue) {
    const minDb = -100; // Minimum expected dB value
    const maxDb = 0; // Maximum dB value (best signal)
    return ((dbValue - minDb) / (maxDb - minDb)) * 100;
  }

  // When user drags or changes the passband
  function handlePassbandChange (passband) {
    let [l, m, r] = passband.detail.map(waterfallOffsetToFrequency)
    let bfo = frequencyInputComponent.getBFO()
    l += bfo
    m += bfo
    r += bfo
    bandwidth = ((r - l) / 1000).toFixed(2)
    frequencyInputComponent.setFrequency(m)
    const audioParameters = [l, m, r].map(frequencyToFFTOffset)
    audio.setAudioRange(...audioParameters)
    updateLink()
    updatePassband()
  }

  // Entering new frequency into the textbox
  function handleFrequencyChange (event) {
    const frequency = event.detail
    const audioRange = audio.getAudioRange()
    const [l, m, r] = audioRange.map(FFTOffsetToFrequency)
  
    // Preserve current bandwidth settings
    let audioParameters = [
      frequency - (m - l),
      frequency,
      frequency + (r - m)
    ].map(frequencyToFFTOffset)
    const newm = audioParameters[1]

    // If the ranges are not within limit, shift it back
    let [waterfallL, waterfallR] = waterfall.getWaterfallRange()
    if ((newm < waterfallL || newm >= waterfallR)) {
      const limits = Math.floor((waterfallR - waterfallL) / 2)
      let offset
      if (audioRange[1] >= waterfallL && audioRange[1] < waterfallR) {
        offset = audioRange[1] - waterfallL
      } else {
        offset = limits
      }
      const newMid = Math.min(waterfall.waterfallMaxSize - limits, Math.max(limits, newm - offset + limits))

      waterfallL = Math.floor(newMid - limits)
      waterfallR = Math.floor(newMid + limits)
      waterfall.setWaterfallRange(waterfallL, waterfallR)
    }
    audio.setAudioRange(...audioParameters)
    updatePassband()
    updateLink()
  }

  // Waterfall magnification controls in the sidebar
  function handleWaterfallMagnify (e, type) {
    let [l, m, r] = audio.getAudioRange()
    const [waterfallL, waterfallR] = waterfall.getWaterfallRange()
    const offset = (m - waterfallL) / (waterfallR - waterfallL) * waterfall.canvasWidth
    switch (type) {
      case 'max':
        m = Math.min(waterfall.waterfallMaxSize - 512, Math.max(512, m))
        l = Math.floor(m - 512)
        r = Math.ceil(m + 512)
        break
      case '+':
        e.coords = { x: offset }
        e.scale = -1
        waterfall.canvasWheel(e)
        updatePassband()
        return
      case '-':
        e.coords = { x: offset }
        e.scale = 1
        waterfall.canvasWheel(e)
        updatePassband()
        return
      case 'min':
        l = 0
        r = waterfall.waterfallMaxSize
        break
    }
    waterfall.setWaterfallRange(l, r)
    updatePassband()
  }

  let mute
  let volume = 50
  let squelchEnable
  let squelch = -50
  let power = 0
  let powerPeak = 0
  const accumulator = RollingMax(10)

  // Bandwidth offset controls
  let bandwithoffsets = [
    '-1000', '-100', '+100', '+1000',
  ]
  function handleBandwidthOffsetClick (e, bandwidthoffset) {
    bandwidthoffset = parseFloat(bandwidthoffset)
    const demodulationDefault = demodulationDefaults[demodulation].type
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency)
    if (demodulationDefault === 'USB') {
      r = Math.max(m, Math.min(m + getMaximumBandwidth(), r + bandwidthoffset))
    } else if (demodulationDefault === 'LSB') {
      l = Math.max(m - getMaximumBandwidth(), Math.min(m, l - bandwidthoffset))
    } else {
      r = Math.max(0, Math.min(m + getMaximumBandwidth() / 2, r + bandwidthoffset / 2))
      l = Math.max(m - getMaximumBandwidth() / 2, Math.min(m, l - bandwidthoffset / 2))
    }
    let audioParameters = [l, m, r].map(frequencyToFFTOffset)
    audio.setAudioRange(...audioParameters)
    updatePassband()
  }

  // Toggle buttons and slides for audio
  function handleMuteChange () {
    mute = !mute
    audio.setMute(mute)
  }
  function handleVolumeChange () {
    audio.setGain(Math.pow(10, (volume - 50) / 50 + 2.6))
  }
  function handleSquelchChange () {
    squelchEnable = !squelchEnable
    audio.setSquelch(squelchEnable)
  }
  function handleSquelchMove () {
    audio.setSquelchThreshold(squelch)
  }

  function handleEnterKey(event) {
      if (event.key === 'Enter') {
          event.preventDefault(); // Prevent the default action
          sendMessage();
      }
  }


  let NREnabled = false
  let NBEnabled = false
  let ANEnabled = false
  function handleNRChange () {
    NREnabled = !NREnabled;
    audio.decoder.set_nr(NREnabled)
  }
  function handleNBChange () {
    NBEnabled = !NBEnabled;
    audio.decoder.set_nb(NBEnabled)
  }
  function handleANChange () {
    ANEnabled = !ANEnabled;
    audio.decoder.set_an(ANEnabled)
  }

  // Regular updating UI elements:
  // Other user tuning displays
  //
  let updateInterval
  let lastUpdated = 0
  function updateTick () {
    power = audio.getPowerDb() / 150 * 100 
    powerPeak = accumulator(power) / 150 * 100 

    if (events.getLastModified() > lastUpdated) {
      const myRange = audio.getAudioRange()
      const clients = events.getSignalClients()
      // Don't show our own tuning
      // Find the id that is closest to myRange[i]
      const myId = Object.keys(clients).reduce((a, b) => {
        const aRange = clients[a]
        const bRange = clients[b]
        const aDiff = Math.abs(aRange[1] - myRange[1])
        const bDiff = Math.abs(bRange[1] - myRange[1])
        return aDiff < bDiff ? a : b
      })
      delete clients[myId]
      waterfall.setClients(clients)
      requestAnimationFrame(() => {
        waterfall.updateGraduation()
        waterfall.drawClients()
      })
      lastUpdated = events.getLastModified()
    }
  }

  // Tune to the frequency when clicked
  let frequencyMarkerComponent
  function handleFrequencyMarkerClick (event) {
    handleFrequencyChange({ detail: event.detail.frequency })
    demodulation = event.detail.modulation
    handleDemodulationChange()
  }

  // Permalink handling
  function updateLink () {
    const linkObj = {
      frequency: frequencyInputComponent.getFrequency().toFixed(0),
      modulation: demodulation
    }
    const linkQuery = constructLink(linkObj)
    link = `${location.origin}${location.pathname}?${linkQuery}`
    storeInLocalStorage(linkObj)
  }
  function handleLinkCopyClick () {
    copy(link)
  }


  let bookmarks = writable([]);
  let newBookmarkName = '';

  let messages = writable([]);
  let newMessage = '';
  let socket;
  let userName = `user${Math.floor(Math.random() * 10000)}`;

  const formatMessage = (text) => {
    const now = new Date();
    return `${userName}: ${text.substring(0, 500)}`; // Ensure message is capped at 25 chars
  };



  function addBookmark() {
    const bookmark = {
      name: newBookmarkName,
      link: link, // Adjust based on how you determine the link
    };
    bookmarks.update(currentBookmarks => {
      const updatedBookmarks = [...currentBookmarks, bookmark];
      localStorage.setItem('bookmarks', JSON.stringify(updatedBookmarks));
      return updatedBookmarks;
    });
    newBookmarkName = '';
  }

  function copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text).then(() => {
        console.log('Text copied to clipboard!');
      });
    } catch (err) {
      console.error('Clipboard write failed', err);
    }
  }


  // Decoder settings
  let logger
  let signalDecoder = 'none'
  const decoders = ['none']//, 'rds', 'ft8']
  async function handleDecoderChange (e, changed) {
    /*if (audio.getSignalDecoder()) {
      audio.getSignalDecoder().stop()
      audio.setSignalDecoder(null)
    }
    if (signalDecoder !== 'none') {
      const decoder = new Decoder(signalDecoder, audio.trueAudioSps, (text) => {
        if (logger) {
          logger.addLine(text)
        }
      })
      // Wait for the decode to initialize before running
      await decoder.promise()
      audio.setSignalDecoder(decoder)
    }*/
  }

  let backendPromise;
  onMount(async () => {
    // Disable all the input to prevent clicking
    [...document.getElementsByTagName('button'), ...document.getElementsByTagName('input')].forEach(element => {
      element.disabled = true
    })
    waterfall.initCanvas({
      canvasElem: waterfallCanvas,
      spectrumCanvasElem: spectrumCanvas,
      graduationCanvasElem: graduationCanvas,
      tempCanvasElem: tempCanvas
    });

    backendPromise = init();
    await backendPromise;

    // Enable after connection established
    [...document.getElementsByTagName('button'), ...document.getElementsByTagName('input')].forEach(element => {
      element.disabled = false
    })

    // Enable WBFM option if bandwidth is wide enough
    if (audio.trueAudioSps > 170000) {
      demodulators.push('WBFM')
      demodulators = demodulators
      bandwithoffsets.unshift('-100000')
      bandwithoffsets.push('+100000')
      bandwithoffsets = bandwithoffsets
    }

    frequencyInputComponent.setFrequency(FFTOffsetToFrequency(audio.getAudioRange()[1]))
    frequencyInputComponent.updateFrequencyLimits(audio.baseFreq, audio.baseFreq + audio.totalBandwidth)
    demodulation = audio.settings.defaults.modulation
  
    const updateParameters = (linkParameters) => {
      frequencyInputComponent.setFrequency(linkParameters.frequency)
      if (frequencyInputComponent.getFrequency() === linkParameters.frequency) {
        handleFrequencyChange({ detail: linkParameters.frequency })
      }
      if (demodulators.indexOf(linkParameters.modulation) !== -1) {
        demodulation = linkParameters.modulation
        handleDemodulationChange({}, true)
      }
      frequencyMarkerComponent.updateFrequencyMarkerPositions()
    }

    /* const storageParameters = loadFromLocalStorage()
    updateParameters(storageParameters) */
    const linkParameters = parseLink(location.search.slice(1))
    updateParameters(linkParameters)

    // Refresh all the controls to the initial value
    updatePassband()
    passbandTunerComponent.updatePassbandLimits()
    handleWaterfallColormapSelect()
    handleDemodulationChange({}, true)
    handleSpectrumChange()
    handleVolumeChange()
    updateLink()
    userId = generateUniqueId();

    const storedBookmarks = localStorage.getItem('bookmarks');
    if (storedBookmarks) {
      bookmarks.set(JSON.parse(storedBookmarks));
    }

    updateInterval = setInterval(() => requestAnimationFrame(updateTick), 200)

    // For debugging
    window['spectrumAudio'] = audio
    window['spectrumWaterfall'] = waterfall

    socket = new WebSocket(window.location.origin.replace(/^http/, 'ws') + '/chat');


    chatContentDiv = document.getElementById("chat_content");

    socket.onmessage = (event) => {
    if (event.data.startsWith("Chat history:")) {
      const history = event.data.replace("Chat history:\n", "").trim();
      if (history) {
        // Split the history into individual messages and wrap each one in an object
        const historyMessages = history.split("\n").map((line, index) => ({
          id: Date.now() + index, // Simple way to generate a unique ID for each historical message
          text: line.trim()
        }));
        messages.set(historyMessages); // Set the processed messages as the chat history

        
        setTimeout(() => {
          chatContentDiv.scrollTop = chatContentDiv.scrollHeight;
        }, 500); 
        
      }
    } else {
      // Wrap real-time messages in an object with a unique ID
      const receivedMessageObject = {
        id: Date.now(), // Ensure uniqueness
        text: event.data.trim() // The actual message text
      };
      messages.update(currentMessages => [...currentMessages, receivedMessageObject]);
      setTimeout(() => {
          chatContentDiv.scrollTop = chatContentDiv.scrollHeight;
        }, 500); 
    }

    

  };



  })

 

  
  function sendMessage() {
    const trimmedMessage = newMessage.trim();
    if (trimmedMessage) {
      const uniqueMessageObject = {
        id: Date.now(), // Still useful for internal tracking
        text: formatMessage(trimmedMessage), // Assuming you have a function to format the message
        raw: {
          cmd: "chat",
          message: trimmedMessage,
          userid: userId // Use the generated unique ID
        }
      };

      // Serialize the object to JSON and send it
      socket.send(JSON.stringify(uniqueMessageObject.raw)); // Send the formatted JSON string to the server
      
      
      // Clear input after sending
      newMessage = ''; 
      
      // Scroll to the latest message (assuming you have a chatContentDiv reference)
      setTimeout(() => {
        chatContentDiv.scrollTop = chatContentDiv.scrollHeight;
      }, 500); 
    }
  }



  onDestroy(() => {
    // Stop everything
    clearInterval(updateInterval)
    audio.stop()
    waterfall.stop()
    socket.close();
  })

  // Mobile gestures
  // Pinch = Mousewheel = Zoom
  let pinchX = 0
  function handleWaterfallPinchStart (e) {
    pinchX = 0
  }
  function handleWaterfallPinchMove (e) {
    const diff = e.detail.scale - pinchX
    pinchX = e.detail.scale
    const scale = 1 - (Math.abs(e.detail.srcEvent.movementX) / waterfallCanvas.getBoundingClientRect().width)
    const evt = e.detail.srcEvent
    evt.coords = { x: e.detail.center.x }
    evt.deltaY = -Math.sign(diff)
    evt.scaleAmount = scale
    waterfall.canvasWheel(evt)
    updatePassband()
    // Prevent mouseup event from firing
    waterfallDragTotal += 2
  }
  // Pan = Mousewheel = waterfall dragging
  function handleWaterfallPanMove (e) {
    if (e.detail.srcEvent.pointerType === 'touch') {
      waterfall.mouseMove(e.detail.srcEvent)
      updatePassband()
    }
  }
</script>

<svelte:window
  on:mousemove={handleWindowMouseMove}
  on:mouseup={handleWindowMouseUp}
  />

<main>
  <div class="h-screen overflow-hidden flex flex-col">
    <div class="w-full  sm:w-1/2 md:w-2/3 lg:w-3/4 sm:transition-all sm:ease-linear sm:duration-100 cursor-crosshair overflow-hidden" style="height: 400px; width:100%;" >
      <FrequencyInput bind:this={frequencyInputComponent} on:change={handleFrequencyChange}></FrequencyInput>
      <canvas class="w-full bg-black peer {spectrumDisplay ? 'max-h-40' : 'max-h-0'}" bind:this={spectrumCanvas}
        on:wheel={handleWaterfallWheel}
        on:click={passbandTunerComponent.handlePassbandClick}
      width="1024" height="128"></canvas>
      <PassbandTuner
        on:change={handlePassbandChange}
        on:wheel={handleWaterfallWheel}
        bind:this={passbandTunerComponent}></PassbandTuner>
      <FrequencyMarkers bind:this={frequencyMarkerComponent}
        on:click={passbandTunerComponent.handlePassbandClick}
        on:wheel={handleWaterfallWheel}
        on:markerclick={handleFrequencyMarkerClick}></FrequencyMarkers>
      <canvas class="w-full bg-black peer" bind:this={graduationCanvas}
        on:wheel={handleWaterfallWheel}
        on:click={passbandTunerComponent.handlePassbandClick}
      width="1024" height="20"></canvas>
      <div class="w-full peer overflow-hidden"><canvas class="w-full bg-black {waterfallDisplay ? 'block' : 'hidden'}" bind:this={waterfallCanvas}
        use:pinch
        on:pinchstart={handleWaterfallPinchStart}
        on:pinchmove={handleWaterfallPinchMove}
        use:pan
        on:panmove={handleWaterfallPanMove}
        on:wheel={handleWaterfallWheel}
        on:mousedown={handleWaterfallMouseDown}
      width="1024" height="100"></canvas>
        <canvas class="hidden" bind:this={tempCanvas} width="1024" height="1024"></canvas>
      </div>
      <!--<div class="fixed border border-black text-xs px-1 hidden 
      transition-opacity duration-100 bg-blue-800 text-gray-400
        peer-hover:block {frequencyHintActive ? 'opacity-1' : 'opacity-0'}"
          style="left: {frequencyHintLeft}px; top: {frequencyHintTop}px;">
        {frequencyHint}
      </div>-->
      <div class="{signalDecoder === 'none' ? 'hidden' : 'block'}">
        <Logger bind:this={logger} capacity={1000}></Logger>
      </div>
    </div>
   <div class="w-full sm:h-screen overflow-y-scroll sm:w-1/2 md:w-1/3 lg:w-1/4 sm:transition-all sm:ease-linear sm:duration-100" style="width:100%;">
       <!--<div class="tab">
        <div class="m-2">
        </div>
      </div>
      <div class="tab relative">
        <div class="flex absolute w-full h-full z-20 text-4xl bg-gray-800/75" id="startaudio">
          <button class="basic-button m-auto">Start Audio</button>
        </div>
        <div class="bg-gray-500 text-left pl-2">
          <label for="tab-multi-one">Audio</label>
        </div>
        <div class="m-2">
          <div class="grid grid-cols-4">
              {#each demodulators as demodulator (demodulator)}
              <label>
                <input type="radio" bind:group={demodulation}
                  on:click={(e) => handleDemodulationChange(e, false)}
                  on:change={(e) => handleDemodulationChange(e, true)}  class="hidden peer" name="demodulation" value={demodulator}
                    autocomplete="off">
                <div class="basic-button m-1"> 
                    {demodulator} 
                </div>
              </label>
              {/each}
          </div>
          <p class="text-white text-sm">Bandwidth: {bandwidth}kHz</p>
          <div class="flex items-center justify-center pb-1 scale-90 sm:scale-75 md:scale-[0.70]">
            {#each bandwithoffsets as bandwidthoffset (bandwidthoffset)}
              <button class="click-button w-1/4" on:click={(e) => handleBandwidthOffsetClick(e, bandwidthoffset)}
                  data-expand="{bandwidthoffset}">{bandwidthoffset}</button>
            {/each}
          </div>
          <div>
            <div class="flex">
              <label class="w-1/6 text-white">
                <input type="checkbox" class="hidden peer" autocomplete="off" bind:checked={mute} on:change={handleMuteChange}>
                <div class="basic-button peer-checked:hidden">
                  🔊
                </div>
                <div class="basic-button hidden peer-checked:block">
                  🔇
                </div>
              </label>
              <div class="w-1/6 text-white text-xs text-center m-auto">{volume}%</div>
              <div class="px-0 w-2/3 align-middle">
                <input type="range" bind:value={volume} on:mousemove={handleVolumeChange} disabled={mute} min="0" max="100" step="0.1" class="disabled: cursor-not-allowed w-full align-middle appearance-none h-1 bg-gray-400 rounded outline-none">
              </div>
            </div>
            <div class="flex">
              <label class="w-1/6 text-white">
                <input type="checkbox" class="hidden peer" autocomplete="off" bind:checked={squelchEnable} on:change={handleSquelchChange}>
                <div class="basic-button line-through thick-line-through peer-checked:no-underline">
                  &nbsp;Sq&nbsp;
                </div>
                <Tooltip text="Squelch"></Tooltip>
              </label>
              <span class="w-1/6 text-white text-xs text-center m-auto">{squelch}db</span>
              <div class="px-0 w-2/3 align-middle">
                <input type="range" bind:value={squelch} on:mousemove={handleSquelchMove} min="-150" max="0" step="0.1" class="w-full align-middle appearance-none h-1 bg-gray-400 rounded outline-none slider-thumb">
              </div>
            </div>
            <div class="flex">
              <span class="w-1/6 text-white text-xs text-center relative basic-button overflow-y-hidden">
                <span
                  class="bg-green-800 w-full h-full absolute left-0 bottom-0 z-10 transition-all"
                  style="transform: translate3d(0, {-power}%, 0)"
                ></span>
                <span
                  class="bg-red-800 w-full h-full absolute left-0 bottom-0 z-0 transition-all"
                  style="transform: translate3d(0, {-powerPeak}%, 0)"
                ></span>
                <span class="relative z-20">Pwr</span>
              </span>
              <span class="w-1/6 text-white text-xs text-center m-auto">{power.toFixed(1)}db</span>
              <div class="px-0 w-2/3 align-middle flex">
                <div class="bg-gray-300 h-1 w-full m-auto rounded-full relative overflow-x-hidden">
                  <span
                    class="bg-green-500 h-1 w-full absolute left-0 top-0 rounded-full z-10 transition-all"
                    style="transform: translate3d({power}%, 0, 0)"
                  ></span>
                  <span
                    class="bg-red-500 h-1 w-full absolute left-0 top-0 rounded-full z-0 transition-all"
                    style="transform: translate3d({powerPeak}%, 0, 0)"
                  ></span>
                </div>
              </div>
            </div>
          </div>
          <div>
            <div class="grid grid-cols-4 my-1">
              <LineThroughButton name="NR" on:change={handleNRChange} bind:checked={NREnabled}>
                <Tooltip text="Noise Reduction"></Tooltip>
              </LineThroughButton>
              <LineThroughButton name="NB" on:change={handleNBChange} bind:checked={NBEnabled}>
                <Tooltip text="Noise Blanker"></Tooltip>
              </LineThroughButton>
              <LineThroughButton name="AN" on:change={handleANChange} bind:checked={ANEnabled}>
                <Tooltip text="Autonotch"></Tooltip>
              </LineThroughButton>
            </div>
          </div>
        </div>
      </div>
      <div class="tab">
        <div class="bg-gray-500 text-left pl-2">
          <label for="tab-multi-one">Waterfall</label>
        </div>
        <div class="m-2">
          <div class="flex flex-wrap items-center content-center justify-center my-1">
            <CheckButton name="Spectrum Analyzer" bind:checked={spectrumDisplay} on:change={handleSpectrumChange}></CheckButton>
            <CheckButton name="Waterfall" bind:checked={waterfallDisplay} on:change={handleWaterfallChange}></CheckButton>
          </div>
          <div class="flex flex-wrap items-center justify-center w-full" aria-label="Bandwidth controls">
              <button class="click-button w-1/4" on:click={(e) => handleWaterfallMagnify(e, 'max')}>🔎max</button>
              <button class="click-button w-1/4" on:click={(e) => handleWaterfallMagnify(e, '+')}>🔎+</button>
              <button class="click-button w-1/4" on:click={(e) => handleWaterfallMagnify(e, '-')}>🔎-</button>
              <button class="click-button w-1/4" on:click={(e) => handleWaterfallMagnify(e, 'min')}>🔎min</button>
          </div>
          <div class="{spectrumDisplay ? 'flex' : 'hidden'}">
            <div class="w-1/6 text-white text-xs align-middle p-auto m-auto">
              Smoothing
            </div>
            <span class="w-1/6 text-white text-xs text-center m-auto">{alpha}</span>
            <div class="px-0 w-2/3 align-middle">
              <input type="range" bind:value={alpha} on:mousemove={handleAlphaMove} min="0" max="1" step="0.01" class="w-full align-middle appearance-none h-1 bg-gray-400 rounded outline-none slider-thumb">
            </div>
          </div>
          <div class="{waterfallDisplay ? 'flex' : 'hidden'}">
            <div class="w-1/6 text-white text-xs align-middle p-auto m-auto">
              Brightness
            </div>
            <span class="w-1/6 text-white text-xs text-center m-auto">{brightness}</span>
            <div class="px-0 w-2/3 align-middle">
              <input type="range" bind:value={brightness} on:mousemove={handleBrightnessMove} min="0" max="255" step="1" class="w-full align-middle appearance-none h-1 bg-gray-400 rounded outline-none slider-thumb">
            </div>
          </div>
          <div class="{waterfallDisplay ? 'flex' : 'hidden'} pt-1">
            <div class="w-1/6 text-white text-xs text-center m-auto">Colormap: </div>
            <div class="w-1/3 flex items-center align-middle m-auto px-2">
              <canvas class="w-full h-4" width="256" bind:this={colormapPreview}></canvas>
            </div>
            <div class="px-0 w-1/2 h-full flex align-middle bg-transparent z-50">
              <select class="h-full w-full py-px bg-transparent text-white text-xs border border-1 border-blue-500"
                bind:value={currentColormap} on:change="{handleWaterfallColormapSelect}">
                {#each availableColormaps as colormap}
                  <option class="m-auto p-auto text-xs bg-black" value={colormap}>
                    {colormap}
                  </option>
                {/each}
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="tab">
        <div class="bg-gray-500 text-left pl-2">
          <label for="tab-multi-one">Bookmarks</label>
        </div>
        <div class="m-2">
          <div class="flex">
            <div class="border border-blue-500 text-blue-500 transition-all duration-100 text-center text-xs px-2 py-1 active:bg-blue-600 active:text-white">
              <button on:click={handleLinkCopyClick}>📋 Link:</button>
              <Popover text="Copied!"></Popover>
            </div>
            <input type="text" class="flex-grow bg-transparent text-white border border-l-0 border-blue-500 text-xs px-2" value={link} readonly/>
          </div>
        </div>
      </div>
      <div class="tab">
        <div class="bg-gray-500 text-left pl-2">
          <label for="tab-multi-one">Decoders</label>
        </div>
        <div class="m-2">
          <div class="grid grid-cols-4">
            {#each decoders as decoder (decoder)}
            <label>
              <input type="radio" bind:group={signalDecoder}
                on:change={(e) => handleDecoderChange(e, true)}  class="hidden peer" name="decoder" value={decoder}
                  autocomplete="off">
              <div class="basic-button m-1"> 
                  {decoder} 
              </div>
            </label>
            {/each}
        </div>
        
    </div>
    <div class="tab">
      <div class="bg-gray-500 text-left pl-2">
        <label for="tab-multi-one">Statistics</label>
      </div>
      <div class="p-4">
        <div class="stats-box bg-white p-4 rounded-lg shadow-md">
          <ul class="list-none space-y-2">
            <li>
              <span class="stat-title text-sm font-medium text-gray-800">User Count: </span>
              <span id="total_user_count" class="stat-value text-sm font-semibold">N/A</span>
            </li>
            <li>
              <span class="stat-title text-sm font-medium text-gray-800">Total Waterfall Stream: </span>
              <span id="total_water_stream" class="stat-value text-sm font-semibold">N/A</span>
            </li>
            <li>
              <span class="stat-title text-sm font-medium text-gray-800">Total Audio Stream: </span>
              <span id="total_audio_stream" class="stat-value text-sm font-semibold">N/A</span>
            </li>
          </ul>
        </div>
      </div>
    </div>-->
    <div class="min-h-screen bg-gray-800 text-white" style="padding-top: 10px;">
      <div class="max-w-screen-lg mx-auto">
        <!-- Tabs -->
        <ul class="flex flex-wrap justify-center cursor-pointer" style="padding-bottom: 15px;">
          <li class={`mx-1 my-1 md:mx-2 px-2 md:px-4 py-1 md:py-2 text-xs md:text-sm rounded-lg ${activeTab === 'audio' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'} text-white`} on:click="{() => setActiveTab('audio')}">Audio</li>
          <li class={`mx-1 my-1 md:mx-2 px-2 md:px-4 py-1 md:py-2 text-xs md:text-sm rounded-lg ${activeTab === 'waterfall' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'} text-white`} on:click="{() => setActiveTab('waterfall')}">Waterfall</li>
          <li class={`mx-1 my-1 md:mx-2 px-2 md:px-4 py-1 md:py-2 text-xs md:text-sm rounded-lg ${activeTab === 'bookmarks' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'} text-white`} on:click="{() => setActiveTab('bookmarks')}">Bookmarks</li>
          <li class={`mx-1 my-1 md:mx-2 px-2 md:px-4 py-1 md:py-2 text-xs md:text-sm rounded-lg ${activeTab === 'decoders' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'} text-white`} on:click="{() => setActiveTab('decoders')}">Decoders</li>
          <li class={`mx-1 my-1 md:mx-2 px-2 md:px-4 py-1 md:py-2 text-xs md:text-sm rounded-lg ${activeTab === 'statistics' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'} text-white`} on:click="{() => setActiveTab('statistics')}">Statistics</li>
          <li class={`mx-1 my-1 md:mx-2 px-2 md:px-4 py-1 md:py-2 text-xs md:text-sm rounded-lg ${activeTab === 'chat' ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'} text-white`} on:click="{() => setActiveTab('chat')}">Chat</li>
        </ul>
        

        
    
        <!-- Tab Content -->
        <!--Audio Tab Start-->
        <div class="{activeTab === 'audio' ? '' : 'hidden'} p-4">
            <div class="flex absolute inset-0 z-20 justify-center items-center bg-gray-800 bg-opacity-75 backdrop-filter backdrop-blur-sm"  id="startaudio">
              <button class="text-white font-bold py-2 px-4 rounded">Start Audio</button>
            </div>
              <div class="m-2">
                <div class="w-full max-w-xs mx-auto">
                  <label for="demodulator-select" class="block text-sm font-medium text-white mb-1">Demodulator:</label>
                  <select id="demodulator-select" bind:value={demodulation} on:change="{(e) => handleDemodulationChange(e, true)}" class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md bg-gray-700 text-white">
                    {#each demodulators as demodulator}
                      <option value="{demodulator}">{demodulator}</option>
                    {/each}
                  </select>
                </div>
              </div>
            
            <div class="flex flex-col space-y-4 mt-4">
              <!-- Mute and Volume Control -->
              <div class="flex items-center justify-center space-x-4">
                <button class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-full"
                        on:click="{(handleMuteChange)}">
                  {mute ? '🔇' : '🔊'}
                </button>
                <input type="range" bind:value={volume} on:mousemove="{handleVolumeChange}"
                      class="range range-primary" disabled="{mute}" min="0" max="100" step="1">
                <span class="text-white min-w-16 text-center">{volume}%</span> <!-- Adjusted -->
              </div>

              

              <!-- Squelch Enable and Level -->
              <div class="flex items-center justify-center space-x-4">
                <button style="background-color: {squelchEnable ? '#10b981' : 'rgb(55 65 81/var(--tw-bg-opacity))'};" class="{`bg-${squelchEnable ? 'red' : 'gray'}-700 hover:bg-${squelchEnable ? 'red' : 'gray'}-600 text-white font-bold py-2 px-4 rounded-full`}"
                        on:click="{(handleSquelchChange)}">
                  Sq
                </button>
                <input type="range" bind:value="{squelch}" on:mousemove="{handleSquelchMove}"
                      class="range range-primary" min="-150" max="0" step="1">
                <span class="text-white min-w-16 text-center">{squelch}db</span> <!-- Adjusted -->
              </div>

              <!-- Bandwidth Display and Adjustment -->
              <div class="mt-4">
                <p class="text-white text-sm text-center mb-2">Bandwidth: {bandwidth} kHz</p>
                <div class="flex justify-center items-center gap-2">
                    {#each bandwithoffsets as bandwidthoffset (bandwidthoffset)}
                        <button class="bg-gray-700 hover:bg-blue-500 text-white font-bold py-1 px-3 rounded transition duration-300 ease-in-out"
                                on:click={(e) => handleBandwidthOffsetClick(e, bandwidthoffset)}
                                title="{bandwidthoffset} kHz">
                            {bandwidthoffset}
                        </button>
                    {/each}
                </div>
              </div>


              
              <!-- Power and Peak Display -->
              <div class="relative pt-1 w-full max-w-xs mx-auto">
                <div class="overflow-hidden h-4 text-xs flex rounded bg-gray-700">
                  <!-- Normalize and display Power -->
                  <div style="transform: translate3d({power}%, 0, 0)"  class="bg-green-500 w-full h-full rounded-l transition-all"></div>
                </div>
                <div class="text-white text-sm mt-2 flex justify-between">
                  <span>Power: {power.toFixed(1)} dB</span>
                  <span>Peak: {powerPeak.toFixed(1)} dB</span>
                </div>
              </div>

              
            </div>

            <div class="flex justify-center gap-4 mt-4">
              <button class="transition-colors duration-300 ease-in-out hover:bg-gray-600 text-white font-bold py-1 px-2 rounded"
                      style="background-color: {NREnabled ? '#10b981' : '#4b5563'};"
                      on:click="{handleNRChange}">
                NR
              </button>
              <button class="transition-colors duration-300 ease-in-out hover:bg-gray-600 text-white font-bold py-1 px-2 rounded"
                      style="background-color: {NBEnabled ? '#10b981' : '#4b5563'};"
                      on:click="{handleNBChange}">
                NB
              </button>
              <button class="transition-colors duration-300 ease-in-out hover:bg-gray-600 text-white font-bold py-1 px-2 rounded"
                      style="background-color: {ANEnabled ? '#10b981' : '#4b5563'};"
                      on:click="{handleANChange}">
                AN
              </button>
          </div>
           
        </div>
        <!--Audio Tab End-->

        <!--Waterfall Tab Start-->
        <div class="{activeTab === 'waterfall' ? '' : 'hidden'} p-4">
          <div class="space-y-4">
              <!-- Bandwidth Controls -->
              <div class="text-center mb-4">
                  <label class="block text-sm font-medium text-white">Bandwidth Controls</label>
                  <div class="flex justify-center gap-2 mt-2 items-center">
                      <button class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-1 px-2 rounded"
                              on:click="{(e) => handleWaterfallMagnify(e, 'max')}">🔎Max</button>
                      <button class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-1 px-2 rounded"
                              on:click="{(e) => handleWaterfallMagnify(e, '+')}">🔎+</button>
                      <button class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-1 px-2 rounded"
                              on:click="{(e) => handleWaterfallMagnify(e, '-')}">🔎-</button>
                      <button class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-1 px-2 rounded"
                              on:click="{(e) => handleWaterfallMagnify(e, 'min')}">🔎Min</button>
                  </div>
              </div>

              <!-- Brightness Control -->
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-white">Min:</label>
                <input type="range" bind:value="{min_waterfall}" min="-100" max="255" step="1"
                        class="range range-primary w-full max-w-md ml-4"
                        on:input="{handleMinMove}">
              </div>
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-white">Max:</label>
                <input type="range" bind:value="{max_waterfall}" min="0" max="255" step="1"
                        class="range range-primary w-full max-w-md ml-4"
                        on:input="{handleMaxMove}">
              </div>

              <!-- Colormap Control -->
              <div class="flex items-center justify-between mt-4">
                  <label class="block text-sm font-medium text-white">Colormap:</label>
                  <select bind:value="{currentColormap}" on:change="{handleWaterfallColormapSelect}"
                          class="block w-full max-w-md ml-4 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md bg-gray-700 text-white">
                      {#each availableColormaps as colormap}
                          <option class="bg-black" value="{colormap}">
                              {colormap}
                          </option>
                      {/each}
                  </select>
              </div>

              <!-- Colormap Preview -->
              <div class="flex items-center justify-between mt-4">
                  <label class="block text-sm font-medium text-white">Colormap Preview:</label>
                  <div class="flex w-full max-w-md ml-4 items-center justify-center bg-gray-800 rounded overflow-hidden">
                      <canvas class="w-full" height="50" bind:this={colormapPreview}></canvas>
                  </div>
              </div>
          </div>
        </div>

        <!--Waterfall Tab End-->
      
        <div class="{activeTab === 'bookmarks' ? '' : 'hidden'} p-4">
          <div class="space-y-4">
            <div class="flex justify-between items-center">
              <h2 class="text-lg font-semibold text-white">Bookmarks</h2>
              <button class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded" on:click="{addBookmark}">Add Current</button>
            </div>
        
            <div class="flex items-center bg-gray-700 rounded-lg overflow-hidden my-2">
              <input class="flex-grow bg-transparent text-white p-2 text-xs focus:outline-none" bind:value="{newBookmarkName}" placeholder="New bookmark name"/>
            </div>
        
            <div class="flex items-center bg-gray-700 rounded-lg overflow-hidden">
              <input type="text" class="flex-grow bg-transparent text-white p-2 text-xs focus:outline-none" value={link} readonly />
              <div class="px-3 py-2 bg-blue-500 hover:bg-blue-600 cursor-pointer" on:click="{handleLinkCopyClick}">📋 Copy</div>
            </div>
        
            <!-- Display bookmarks -->
            {#each $bookmarks as bookmark}
              <div class="flex items-center bg-gray-700 rounded-lg overflow-hidden my-2">
                <div class="flex-grow text-white p-2 text-xs">{bookmark.name}</div>
                <div class="px-3 py-2 bg-green-500 hover:bg-green-600 cursor-pointer" on:click={() => copy(bookmark.link)}>Copy Link</div>
              </div>
            {/each}
          </div>
        </div>
      
        <div class="{activeTab === 'decoders' ? '' : 'hidden'} p-4">
          <div class="space-y-6">
              <!-- Decoding Options -->
              <div class="text-center">
                  <div class="mb-4">
                      <h3 class="text-xl font-semibold text-white">Decoder Options</h3>
                      <div class="mt-4 flex items-center justify-center gap-4">
                          <label class="flex items-center cursor-pointer">
                              <input type="radio" class="hidden" name="decoderOption" value="none" on:change="{(e) => handleFt8Decoder(e, false)}" checked />
                              <span style="background-color: {!ft8Enabled ? '#10b981' : '#4b5563'};" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded">None</span>
                          </label>
                          <label class="flex items-center cursor-pointer">
                              <input type="radio" class="hidden" name="decoderOption" value="ft8" on:change="{(e) => handleFt8Decoder(e, true)}" />
                              <span style="background-color: {ft8Enabled ? '#10b981' : '#4b5563'};" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded">FT8</span>
                          </label>
                      </div>
                  </div>
              </div>
      
              <!-- FT8 Messages List, initially hidden, shown only if FT8 is enabled -->
              {#if ft8Enabled}
              <div class="bg-gray-700 rounded-lg overflow-hidden">
                  <div class="p-4">
                      <h4 class="text-white font-semibold text-lg" style="display: inline-block;">FT8 Messages </h4>
                      <h4 class="text-white font-semibold text-lg" style="display: inline-block;" id="farthest-distance"> - Farthest Distance:</h4>
                      <div class="mt-2 text-white overflow-auto max-h-60" id="ft8MessagesList">
                          <!-- Dynamic content populated here -->
                      </div>
                  </div>
              </div>
              {/if}
          </div>
      </div>
      
      
      </div>      
      <div class="{activeTab === 'statistics' ? '' : 'hidden'} p-4">
          <div class="text-center mb-6">
              <h2 class="text-xl font-semibold text-white mb-4">Live Statistics Overview</h2>
              <p class="text-gray-400">Insights into current platform usage.</p>
          </div>
      
          <div class="flex flex-wrap justify-center gap-8">
              <div class="flex flex-col bg-gray-700 p-4 rounded-lg shadow-md w-full max-w-sm items-stretch">
                  <h3 class="text-white font-semibold text-lg text-center">Waterfall Bandwidth</h3>
                  <span id="total_water_stream" class="stat-value text-2xl font-bold text-blue-400 mt-2 text-center">N/A kbits</span>
                  <p class="text-gray-400 mt-2 text-center">Total bandwidth of all waterfall streams.</p>
              </div>
      
              <div class="flex flex-col bg-gray-700 p-4 rounded-lg shadow-md w-full max-w-sm items-stretch">
                  <h3 class="text-white font-semibold text-lg text-center">Audio Bandwidth</h3>
                  <span id="total_audio_stream" class="stat-value text-2xl font-bold text-green-400 mt-2 text-center">N/A kbits</span>
                  <p class="text-gray-400 mt-2 text-center">Total bandwidth of all audio streams.</p>
              </div>
      
              <div class="flex flex-col bg-gray-700 p-4 rounded-lg shadow-md w-full max-w-sm items-stretch">
                  <h3 class="text-white font-semibold text-lg text-center">User Count</h3>
                  <span id="total_user_count" class="stat-value text-2xl font-bold text-yellow-400 mt-2 text-center">N/A</span>
                  <p class="text-gray-400 mt-2 text-center">Current number of connected users.</p>
              </div>
          </div>
      </div>
      <div class="{activeTab === 'chat' ? '' : 'hidden'} p-4">
          <div class="space-y-4">
              <!-- Chat Messages Container -->
              <div class="overflow-auto h-64 bg-gray-700 rounded-lg p-4 text-left" id="chat_content">
                  {#each $messages as {id, text} (id)}
                      <!-- Individual Message -->
                      <div class="bg-gray-700 text-white p-2 rounded-lg" style="max-width: 80%; word-break: break-word;">
                          {text}
                      </div>
                  {/each}
              </div>
      
              <!-- Message Input -->
              <div class="flex">
                  <input
                      class="flex-grow bg-gray-700 text-white p-2 rounded-l outline-none focus:ring-2 focus:ring-blue-500"
                      bind:value={newMessage}
                      on:keydown={handleEnterKey}
                      placeholder="Type a message..."
                  />
                  <button
                      class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-r"
                      on:click={sendMessage}
                  >
                      Send
                  </button>
              </div>
          </div>
      </div>
    
      
    
    
    
      </div>
    </div>
    
    
  </div>
</main>


<style global lang="postcss">
  :root {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
      Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  }

  .full-screen-container {
    display: flex;
    flex-direction: row;
    height: 100vh;
  }

  .side-nav {
    flex-basis: 250px; /* Adjust based on preference */
    overflow-y: auto;
    background-color: #333;
    color: #fff;
  }

  .main-content {
    flex-grow: 1;
    overflow-y: auto;
    padding: 20px;
    max-width: 1200px; /* Prevents content from stretching too wide */
    margin: auto;
  }

  .tab-content {
    display: none; /* Hide all tab content by default */
  }

  .tab-content.active {
    display: block; /* Only show the active tab */
  }

	:global(body.light-mode) {
		background-color: #A9A9A9;
		transition: background-color 0.3s
	}
	:global(body) {
		background-color: #212121;
	}

  main {
    text-align: center;
    margin: 0 auto;
  }
  .thick-line-through {
    text-decoration-thickness: 2px;
  }
  
  .basic-button {
    @apply text-blue-500 border border-blue-500 font-bold uppercase transition-all duration-100 text-center text-xs px-2 py-1
            peer-checked:bg-blue-600 peer-checked:text-white;
  }
  .basic-button:hover {
    @apply border-blue-400 text-white;
  }

  .click-button {
    @apply text-blue-500 border border-blue-500 font-bold uppercase transition-all duration-100 text-center text-xs px-2 py-1;
  }
  .click-button:active {
    @apply bg-blue-600 text-white;
  }






</style>
