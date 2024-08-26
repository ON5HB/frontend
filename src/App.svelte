<script>
  import { onDestroy, onMount, tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import copy from "copy-to-clipboard";
  import { RollingMax } from "efficient-rolling-stats";
  import { writable } from "svelte/store";

  import PassbandTuner from "./lib/PassbandTuner.svelte";
  import FrequencyInput from "./lib/FrequencyInput.svelte";
  import FrequencyMarkers from "./lib/FrequencyMarkers.svelte";




  import { pinch, pan } from "./lib/hammeractions.js";
  import { availableColormaps } from "./lib/colormaps";
  import {
    init,
    audio,
    waterfall,
    events,
    FFTOffsetToFrequency,
    frequencyToFFTOffset,
    frequencyToWaterfallOffset,
    getMaximumBandwidth,
    waterfallOffsetToFrequency,
  } from "./lib/backend.js";
  import {
    constructLink,
    parseLink,
    storeInLocalStorage,
  } from "./lib/storage.js";


  let waterfallCanvas;
  let spectrumCanvas;
  let graduationCanvas;
  let bandPlanCanvas;
  let tempCanvas;

  let frequencyInputComponent;

  let frequency;

  let passbandTunerComponent;

  let link;
  var chatContentDiv;


  function generateUniqueId() {
    return (
      Math.random().toString(36).substr(2, 10) +
      Math.random().toString(36).substr(2, 10)
    );
  }

  let userId; // Global variable to store the user's unique ID
  let autoAdjust = false;

  // Updates the passband display
  function updatePassband(passband) {
    passband = passband || audio.getAudioRange();
    const frequencies = passband.map(FFTOffsetToFrequency);
    // Bandwidth display also needs updating
    bandwidth = ((frequencies[2] - frequencies[0]) / 1000).toFixed(2);
    // Passband Display
    const offsets = frequencies.map(frequencyToWaterfallOffset);
    passbandTunerComponent.changePassband(offsets);
  }
  // Wheel zooming, update passband and markers
  function handleWaterfallWheel(e) {
    waterfall.canvasWheel(e);
    passbandTunerComponent.updatePassbandLimits();
    updatePassband();
    frequencyMarkerComponent.updateFrequencyMarkerPositions();
    
  }

  // Decoder
  let ft8Enabled = false;

  // Handling dragging the waterfall left or right
  let waterfallDragging = false;
  let waterfallDragTotal = 0;
  let waterfallBeginX = 0;
  function handleWaterfallMouseDown(e) {
    waterfallDragTotal = 0;
    waterfallDragging = true;
    waterfallBeginX = e.clientX;
  }
  function handleWindowMouseMove(e) {
    if (waterfallDragging) {
      waterfallDragTotal += Math.abs(e.movementX) + Math.abs(e.movementY);
      waterfall.mouseMove(e);
      updatePassband();
      frequencyMarkerComponent.updateFrequencyMarkerPositions();
    }
  }
  function handleWindowMouseUp(e) {
    if (waterfallDragging) {
      // If mouseup without moving, handle as click
      if (waterfallDragTotal < 2) {
        passbandTunerComponent.handlePassbandClick(e);
      }
      waterfallDragging = false;
    }
  }

  // Sidebar controls for waterfall and spectrum analyzer
  let waterfallDisplay = true;
  let spectrumDisplay = true;
  let biggerWaterfall = false;
  function handleSpectrumChange() {
    spectrumDisplay = !spectrumDisplay;
    waterfall.setSpectrum(spectrumDisplay);
  }

  function handleWaterfallSizeChange() {
    biggerWaterfall = !biggerWaterfall;
    waterfall.setWaterfallBig(biggerWaterfall);
  }


  let bandwidth;

  // Waterfall drawing
  let currentColormap = "twentev2";
  let alpha = 0.5;
  let brightness = 130;
  let min_waterfall = -30;
  let max_waterfall = 110;
  function handleWaterfallColormapSelect(event) {
    waterfall.setColormap(currentColormap);
    //drawColormapPreview(currentColormap, colormapPreview)
  }

  // Waterfall slider controls
  function handleAlphaMove() {
    waterfall.setAlpha(1 - alpha);
  }
  function handleBrightnessMove() {
    waterfall.setOffset(brightness);
  }
  function handleMinMove() {
    waterfall.setMinOffset(min_waterfall);
  }
  function handleMaxMove() {
    waterfall.setMaxOffset(max_waterfall);
  }

  function handleAutoAdjust(value) {
    autoAdjust = value;
    waterfall.autoAdjust = autoAdjust;
  }

  // Audio demodulation selection
  let demodulators = ["USB", "LSB", "CW-U", "CW-L", "AM", "FM"];
  const demodulationDefaults = {
    USB: { type: "USB", offsets: [-100, 2700] },
    LSB: { type: "LSB", offsets: [2700, -100] },
    "CW-U": { type: "USB", offsets: [-500, 1000], bfo: -700 },
    "CW-L": { type: "LSB", offsets: [1000, -500], bfo: 700 },
    AM: { type: "AM", offsets: [5000, 5000] },
    FM: { type: "FM", offsets: [5000, 5000] },
    WBFM: { type: "FM", offsets: [95000, 95000] },
  };
  let demodulation = "USB";
  function roundAudioOffsets(offsets) {
    const [l, m, r] = offsets;
    return [Math.floor(l), m, Math.floor(r)];
  }
  function SetMode(mode) {
    demodulation = mode;
    handleDemodulationChange(null, true);
  }

  // Demodulation controls
  function handleDemodulationChange(e, changed) {
    passbandTunerComponent.setMode(demodulation);
    const demodulationDefault = demodulationDefaults[demodulation];
    if (changed) {
      if (demodulation === "WBFM") {
        audio.setFmDeemph(50e-6);
      } else {
        audio.setFmDeemph(0);
      }
      audio.setAudioDemodulation(demodulationDefault.type);
    }
    let prevBFO = frequencyInputComponent.getBFO();
    let newBFO = demodulationDefault.bfo || 0;
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency);
    m = m + newBFO - prevBFO;
    l = m - demodulationDefault.offsets[0];
    r = m + demodulationDefault.offsets[1];

    frequencyInputComponent.setBFO(newBFO);
    frequencyInputComponent.setFrequency();

    frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(2);

    const audioParameters = [l, m, r].map(frequencyToFFTOffset);
    audio.setAudioRange(...audioParameters);
    updatePassband();
    updateLink();
  }

  function handleFt8Decoder(e, value) {
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
  function handlePassbandChange(passband) {
    let [l, m, r] = passband.detail.map(waterfallOffsetToFrequency);
    let bfo = frequencyInputComponent.getBFO();
    bfo = 0;
    l += bfo;
    m += bfo;
    r += bfo;
    bandwidth = ((r - l) / 1000).toFixed(2);
    frequencyInputComponent.setFrequency(m);
    frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(2);
    const audioParameters = [l, m, r].map(frequencyToFFTOffset);
    audio.setAudioRange(...audioParameters);
    updateLink();
    updatePassband();
  }

  // Entering new frequency into the textbox
  function handleFrequencyChange(event) {
    const frequency = event.detail;
    const audioRange = audio.getAudioRange();
    const [l, m, r] = audioRange.map(FFTOffsetToFrequency);

    // Preserve current bandwidth settings
    let audioParameters = [
      frequency - (m - l),
      frequency,
      frequency + (r - m),
    ].map(frequencyToFFTOffset);
    const newm = audioParameters[1];

    // If the ranges are not within limit, shift it back
    let [waterfallL, waterfallR] = waterfall.getWaterfallRange();
    if (newm < waterfallL || newm >= waterfallR) {
      const limits = Math.floor((waterfallR - waterfallL) / 2);
      let offset;
      if (audioRange[1] >= waterfallL && audioRange[1] < waterfallR) {
        offset = audioRange[1] - waterfallL;
      } else {
        offset = limits;
      }
      const newMid = Math.min(
        waterfall.waterfallMaxSize - limits,
        Math.max(limits, newm - offset + limits),
      );

      waterfallL = Math.floor(newMid - limits);
      waterfallR = Math.floor(newMid + limits);
      waterfall.setWaterfallRange(waterfallL, waterfallR);
    }
    audio.setAudioRange(...audioParameters);
    updatePassband();
    updateLink();
  }

  // Waterfall magnification controls
  function handleWaterfallMagnify(e, type) {
    let [l, m, r] = audio.getAudioRange();
    const [waterfallL, waterfallR] = waterfall.getWaterfallRange();
    const offset =
      ((m - waterfallL) / (waterfallR - waterfallL)) * waterfall.canvasWidth;
    switch (type) {
      case "max":
        m = Math.min(waterfall.waterfallMaxSize - 512, Math.max(512, m));
        l = Math.floor(m - 512);
        r = Math.ceil(m + 512);
        break;
      case "+":
        e.coords = { x: offset };
        e.scale = -1;
        waterfall.canvasWheel(e);
        updatePassband();
        return;
      case "-":
        e.coords = { x: offset };
        e.scale = 1;
        waterfall.canvasWheel(e);
        updatePassband();
        return;
      case "min":
        l = 0;
        r = waterfall.waterfallMaxSize;
        break;
    }
    waterfall.setWaterfallRange(l, r);
    updatePassband();
  }

  let mute;
  let volume = 50;
  let squelchEnable;
  let squelch = -50;
  let power = 0;
  let powerPeak = 0;
  const numberOfDots = 35; // Number of dots to represent the range from -100 to 0 dB
  const s9Index = 17; // Index of S9 (This may change based on your scale)
  const accumulator = RollingMax(10);

  // Function to draw the S-meter
  function drawSMeter(value) {
    const canvas = document.getElementById("sMeter");
    const ctx = canvas.getContext("2d");

    canvas.width = 300;
    canvas.height = 40;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const segmentWidth = 6;
    const segmentGap = 3;
    const segmentHeight = 8;
    const lineY = 15;
    const labelY = 25;
    const tickHeight = 5;
    const longTickHeight = 5;

    const s9Position = width / 2;

    ctx.strokeStyle = "#a7e6fe";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(s9Position, lineY);
    ctx.stroke();

    ctx.strokeStyle = "#ed1c24";
    ctx.beginPath();
    ctx.moveTo(s9Position, lineY);
    ctx.lineTo(268, lineY);
    ctx.stroke();

    for (let i = 0; i < 30; i++) {
      const x = i * (segmentWidth + segmentGap);
      if (i < value) {
        ctx.fillStyle = i < 17 ? "#a3eced" : "#d9191c";
      } else {
        ctx.fillStyle = i < 17 ? "#003333" : "#330000";
      }
      ctx.fillRect(x, 0, segmentWidth, segmentHeight);
    }

    ctx.font = "11px monospace";
    ctx.textAlign = "center";

    const labels = ["S1", "3", "5", "7", "9", "+20", "+40", "+60dB"];

    for (let i = 0; i <= 16; i++) {
      const x = i * 16.6970588235;
      ctx.fillStyle = x <= s9Position ? "#a3eced" : "#d9191c";

      if (i % 2 === 1) {
        ctx.fillRect(x, lineY, 1, longTickHeight + 2);
        if ((i - 1) / 2 < labels.length) {
          ctx.fillText(labels[(i - 1) / 2], x, labelY + 8);
        }
      } else {
        ctx.fillRect(x, lineY, 1, tickHeight);
      }
    }
  }

  // Function to update signal strength
  function setSignalStrength(db) {
    db = Math.min(Math.max(db, -100), 0);
    const activeSegments = Math.round(((db + 100) * numberOfDots) / 100);

    drawSMeter(activeSegments);
  }

  function handleWheel(node) {
    function onWheel(event) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -1 : 1;
      const step = event.shiftKey ? 1 : 0.1;
      frequency = Math.max(0, Number((parseFloat(frequency) + delta * step).toFixed(3)));
      frequencyInputComponent.setFrequency(frequency * 1e3);
      handleFrequencyChange({ detail: frequency * 1e3 });
      dispatch('frequencyChange', frequency * 1e3);
    }

    node.addEventListener('wheel', onWheel);

    return {
      destroy() {
        node.removeEventListener('wheel', onWheel);
      }
    };
  }


  // Bandwidth offset controls
  let bandwithoffsets = ["-1000", "-100", "+100", "+1000"];
  function handleBandwidthOffsetClick(e, bandwidthoffset) {
    bandwidthoffset = parseFloat(bandwidthoffset);
    const demodulationDefault = demodulationDefaults[demodulation].type;
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency);
    if (demodulationDefault === "USB") {
      r = Math.max(m, Math.min(m + getMaximumBandwidth(), r + bandwidthoffset));
    } else if (demodulationDefault === "LSB") {
      l = Math.max(m - getMaximumBandwidth(), Math.min(m, l - bandwidthoffset));
    } else {
      r = Math.max(
        0,
        Math.min(m + getMaximumBandwidth() / 2, r + bandwidthoffset / 2),
      );
      l = Math.max(
        m - getMaximumBandwidth() / 2,
        Math.min(m, l - bandwidthoffset / 2),
      );
    }
    let audioParameters = [l, m, r].map(frequencyToFFTOffset);
    audio.setAudioRange(...audioParameters);
    updatePassband();
  }

  // Toggle buttons and slides for audio
  function handleMuteChange() {
    mute = !mute;
    audio.setMute(mute);
  }
  function handleVolumeChange() {
    audio.setGain(Math.pow(10, (volume - 50) / 50 + 2.6));
  }
  function handleSquelchChange() {
    squelchEnable = !squelchEnable;
    audio.setSquelch(squelchEnable);
  }
  function handleSquelchMove() {
    audio.setSquelchThreshold(squelch);
  }

  function handleEnterKey(event) {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent the default action
      sendMessage();
    }
  }

  let NREnabled = false;
  let NBEnabled = false;
  let ANEnabled = false;
  let CTCSSSupressEnabled = false;
  function handleNRChange() {
    NREnabled = !NREnabled;
    audio.decoder.set_nr(NREnabled);
  }
  function handleNBChange() {
    NBEnabled = !NBEnabled;
    audio.nb = NBEnabled;
    audio.decoder.set_nb(NBEnabled);
  }
  function handleANChange() {
    ANEnabled = !ANEnabled;
    audio.decoder.set_an(ANEnabled);
  }
  function handleCTCSSChange() {
    CTCSSSupressEnabled = !CTCSSSupressEnabled;
    audio.setCTCSSFilter(CTCSSSupressEnabled);
  }

  // Regular updating UI elements:
  // Other user tuning displays
  //
  let updateInterval;
  let lastUpdated = 0;

  function updateTick() {
    power = (audio.getPowerDb() / 150) * 100 + audio.smeter_offset;
    powerPeak = (accumulator(power) / 150) * 100 + audio.smeter_offset;

    setSignalStrength(power);

    if (events.getLastModified() > lastUpdated) {
      const myRange = audio.getAudioRange();
      const clients = events.getSignalClients();
      // Don't show our own tuning
      // Find the id that is closest to myRange[i]
      const myId = Object.keys(clients).reduce((a, b) => {
        const aRange = clients[a];
        const bRange = clients[b];
        const aDiff = Math.abs(aRange[1] - myRange[1]);
        const bDiff = Math.abs(bRange[1] - myRange[1]);
        return aDiff < bDiff ? a : b;
      });
      delete clients[myId];
      waterfall.setClients(clients);
      requestAnimationFrame(() => {
        waterfall.updateGraduation();
        waterfall.drawClients();
      });
      lastUpdated = events.getLastModified();
    }
  }

  // Tune to the frequency when clicked
  let frequencyMarkerComponent;
  function handleFrequencyMarkerClick(event) {
    handleFrequencyChange({ detail: event.detail.frequency });
    demodulation = event.detail.modulation;
    handleDemodulationChange();
  }

  // Permalink handling
  function updateLink() {
    const linkObj = {
      frequency: frequencyInputComponent.getFrequency().toFixed(0),
      modulation: demodulation,
    };
    frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(2);
    const linkQuery = constructLink(linkObj);
    link = `${location.origin}${location.pathname}?${linkQuery}`;
    storeInLocalStorage(linkObj);
  }
  function handleLinkCopyClick() {
    copy(link);
  }

  let bookmarks = writable([]);
  let newBookmarkName = "";

  let messages = writable([]);
  let newMessage = "";
  let socket;
  


  let username = `user${Math.floor(Math.random() * 10000)}`;
  let showUsernameInput  = false;

  onMount(() => {
    username = localStorage.getItem('chatusername') || '';
    if(!username) {
      console.log("No Username. Setting a random username.");
      username = `user${Math.floor(Math.random() * 10000)}`
    }
    showUsernameInput  = !username;
  });

  function saveUsername() {
    localStorage.setItem('chatusername', username);
    showUsernameInput  = false;
  }

  function editUsername() {
    showUsernameInput  = true;
  }

  const formatMessage = (text) => {
    const now = new Date();
    return `${username}: ${text.substring(0, 500)}`; // Ensure message is capped at 25 chars
  };




  function addBookmark() {
    const bookmark = {
      name: newBookmarkName,
      link: link,
      frequency: frequencyInputComponent.getFrequency(),
      demodulation: demodulation,
    };
    frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(2);
    bookmarks.update((currentBookmarks) => {
      const updatedBookmarks = [...currentBookmarks, bookmark];
      localStorage.setItem("bookmarks", JSON.stringify(updatedBookmarks));
      return updatedBookmarks;
    });
    newBookmarkName = "";
  }

  function goToBookmark(bookmark) {
    // Set frequency
    frequencyInputComponent.setFrequency(bookmark.frequency);
    handleFrequencyChange({ detail: bookmark.frequency });

    // Set demodulation
    demodulation = bookmark.demodulation;
    handleDemodulationChange(null, true);

    // Update the link
    updateLink();
  }

  function copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text).then(() => {
        console.log("Text copied to clipboard!");
      });
    } catch (err) {
      console.error("Clipboard write failed", err);
    }
  }

  function deleteBookmark(index) {
    bookmarks.update((currentBookmarks) => {
      const updatedBookmarks = currentBookmarks.filter((_, i) => i !== index);
      saveBookmarks(updatedBookmarks);
      return updatedBookmarks;
    });
  }

  function saveBookmarks(bookmarksToSave) {
    localStorage.setItem("bookmarks", JSON.stringify(bookmarksToSave));
  }

  let showBookmarkPopup = false;

  function toggleBookmarkPopup() {
    showBookmarkPopup = !showBookmarkPopup;
  }


  let currentStep = 0;
  let showTutorial = false;
  let isFirstTime = false;
  let highlightedElement = null;

  const tutorialSteps = [
    {
      selector: "#demodulator-select",
      content: "Welcome to PhantomSDR - This is the Tutorial.",
    },

    {
      selector: "#waterfall",
      content: "This is the Waterfall, the main part of a WebSDR where you see all signals visuallly.",
    },

    {
      selector: "#volume-slider",
      content: "Use this Slider to change the Volume.",
    },
    {
      selector: "#squelch-slider",
      content: "Use this Slider to change the Squelch.",
    },
    {
      selector: "#ft8-decoder",
      content: "This Button lets you Decode FT8 Signals, if you are on the proper Frequency"
    },
    {
      selector: "#smeter-tut",
      content: "This Section shows you the S-Meter, lets you Input the Frequency and shows the Mode with Filter Bandwidth.",
    },
    {
      selector: "#demodulator-select",
      content: "Use this Section to change the Demodulation Mode.",
    },
    
    {
      selector: "#zoom-controls",
      content: "Use these buttons to zoom in and out of the waterfall display.",
    },
    {
      selector: "#moreoptions",
      content:
        "These options allow you to enable things like CTCSS Supression, Noise Reduction and more.",
    },
    {
      selector: "#brightness-controls",
      content: "Adjust the brightness levels of the waterfall display.",
    },
    {
      selector: "#colormap-select",
      content: "Choose different color schemes for the waterfall.",
    },
    {
      selector: "#auto-adjust",
      content: "Toggle automatic adjustment of the waterfall display.",
    },
    {
      selector: "#spectrum-toggle",
      content: "Turn the spectrum display on or off.",
    },
    {
      selector: "#bigger-waterfall",
      content: "Increase the size of the waterfall display.",
    },
    {
      selector: "#bookmark-button",
      content: "Click this to open the Bookmarks Menu.",
    },
    {
      selector: "#chat-box",
      content: "This is the Chatbox, where to communicae with other users and sending Frequencies"
    },
    {
      selector: "#chat-box",
      content: "Thank you for completing the Tutorial, now you can use the WebSDR as you wish. Enjoy!"
    },
    
    
  ];

  async function initTutorial() {
    if (!localStorage.getItem("TutorialComplete")) {
      await tick();
      const allElementsPresent = tutorialSteps.every((step) =>
        document.querySelector(step.selector),
      );
      if (allElementsPresent) {
        showTutorial = true;
	isFirstTime = true;
        updateHighlightedElement();
        updateHighlightedElement();
      } else {
        console.warn("Some tutorial elements are missing. Skipping tutorial.");
        localStorage.setItem("TutorialComplete", "true");
      }
    }
  }

  function updateHighlightedElement() {
    const { selector } = tutorialSteps[currentStep];
    highlightedElement = selector ? document.querySelector(selector) : null;
  }

  async function nextStep() {
    if (currentStep < tutorialSteps.length - 1) {
      currentStep += 1;
      await tick();
      updateHighlightedElement();
      if (currentStep == 7) {
        activeTab = "waterfall";
      }
    } else {
      endTutorial();
    }
  }

  function endTutorial() {
    showTutorial = false;
    localStorage.setItem("TutorialComplete", "true");
  }

  initTutorial();

  let backendPromise;
  onMount(async () => {

    if (!localStorage.getItem("TutorialComplete")) {
      await tick();
      const allElementsPresent = tutorialSteps
        .slice(1)
        .every((step) => document.querySelector(step.selector));
      if (allElementsPresent) {
	isFirstTime = true;
        showTutorial = true;
        await updateHighlightedElement();
      } else {
        console.warn("Some tutorial elements are missing. Skipping tutorial.");
        localStorage.setItem("TutorialComplete", "true");
      }
    }

    waterfall.initCanvas({
      canvasElem: waterfallCanvas,
      spectrumCanvasElem: spectrumCanvas,
      graduationCanvasElem: graduationCanvas,
      bandPlanCanvasElem: bandPlanCanvas,
      tempCanvasElem: tempCanvas,
    });

    backendPromise = init();
    await backendPromise;

    // Enable after connection established
    [
      ...document.getElementsByTagName("button"),
      ...document.getElementsByTagName("input"),
    ].forEach((element) => {
      element.disabled = false;
    });

    

    // Enable WBFM option if bandwidth is wide enough
    if (audio.trueAudioSps > 170000) {
      demodulators.push("WBFM");
      demodulators = demodulators;
      bandwithoffsets.unshift("-100000");
      bandwithoffsets.push("+100000");
      bandwithoffsets = bandwithoffsets;
    }

    frequencyInputComponent.setFrequency(
      FFTOffsetToFrequency(audio.getAudioRange()[1]),
    );
    frequencyInputComponent.updateFrequencyLimits(
      audio.baseFreq,
      audio.baseFreq + audio.totalBandwidth,
    );

    
 

    demodulation = audio.settings.defaults.modulation;

    const updateParameters = (linkParameters) => {
      frequencyInputComponent.setFrequency(linkParameters.frequency);
      if (frequencyInputComponent.getFrequency() === linkParameters.frequency) {
        handleFrequencyChange({ detail: linkParameters.frequency });
      }
      if (demodulators.indexOf(linkParameters.modulation) !== -1) {
        demodulation = linkParameters.modulation;
        handleDemodulationChange({}, true);
      }
      frequencyMarkerComponent.updateFrequencyMarkerPositions();
    };

    /* const storageParameters = loadFromLocalStorage()
    updateParameters(storageParameters) */
    const linkParameters = parseLink(location.search.slice(1));
    updateParameters(linkParameters);

    // Refresh all the controls to the initial value
    updatePassband();
    passbandTunerComponent.updatePassbandLimits();
    handleWaterfallColormapSelect();
    handleDemodulationChange({}, true);
    handleSpectrumChange();
    handleVolumeChange();
    updateLink();
    userId = generateUniqueId();
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency);

    const storedBookmarks = localStorage.getItem("bookmarks");
    if (storedBookmarks) {
      bookmarks.set(JSON.parse(storedBookmarks));
    }

    updateInterval = setInterval(() => requestAnimationFrame(updateTick), 200);


    window["spectrumAudio"] = audio;
    window["spectrumWaterfall"] = waterfall;


    socket = new WebSocket(
      window.location.origin.replace(/^http/, "ws") + "/chat",
    );

    chatContentDiv = document.getElementById("chat_content");

    socket.onmessage = (event) => {
      if (event.data.startsWith("Chat history:")) {
        const history = event.data.replace("Chat history:\n", "").trim();
        if (history) {
          const historyMessages = history.split("\n").map((line, index) => ({
            id: Date.now() + index,
            text: line.trim(),
            isCurrentUser: line.startsWith(userId),
            timestamp: Date.now() - (history.length - index) * 1000, // Approximate timestamp
          }));
          messages.set(historyMessages);
        }
      } else {
        const receivedMessageObject = {
          id: Date.now(),
          text: event.data.trim(),
          isCurrentUser: event.data.startsWith(userId),
          timestamp: Date.now(),
        };
        messages.update((currentMessages) => [
          ...currentMessages,
          receivedMessageObject,
        ]);
      }
      scrollToBottom();
    };

    const middleColumn = document.getElementById('middle-column');
    const chatBox = document.getElementById('chat-box');
    
    function setWidth() {
      const width = middleColumn.offsetWidth;
      document.documentElement.style.setProperty('--middle-column-width', `1300px`);
    }

    setWidth();
    window.addEventListener('resize', setWidth);

    return () => {
      window.removeEventListener('resize', setWidth);
    };
  });

  function sendMessage() {
    if (newMessage.trim() && username.trim()) {
      const messageObject = {
        cmd: "chat",
        message: newMessage.trim(),
        username: username
      };
      socket.send(JSON.stringify(messageObject));
      newMessage = "";
      scrollToBottom();
    }
  }

  function pasteFrequency() {
    const frequency = frequencyInputComponent.getFrequency();
    const currentDemodulation = demodulation;
    const frequencyText = `[FREQ:${Math.round(frequency)}:${currentDemodulation}]`;
    newMessage = newMessage + " " + frequencyText; // Append the frequency to the current message
  }

  function shareFrequency() {
    const frequency = frequencyInputComponent.getFrequency();
    const currentDemodulation = demodulation;
    const shareMessage = `[FREQ:${Math.round(frequency)}:${currentDemodulation}] Check out this frequency!`;
    const messageObject = {
      cmd: "chat",
      message: shareMessage,
      userid: userId,
    };
    socket.send(JSON.stringify(messageObject));
    scrollToBottom();
  }

  function scrollToBottom() {
    setTimeout(() => {
      chatContentDiv.scrollTop = chatContentDiv.scrollHeight;
    }, 100);
  }

  // Function to handle clicking on a shared frequency
  function handleFrequencyClick(frequency, mode) {
    console.log("Clicked frequency:", frequency, "Type:", typeof frequency);
    const numericFrequency = parseInt(frequency, 10);
    if (isNaN(numericFrequency)) {
      console.error("Invalid frequency:", frequency);
      return;
    }
    frequencyInputComponent.setFrequency(numericFrequency);
    handleFrequencyChange({ detail: numericFrequency });
    demodulation = mode;
    handleDemodulationChange(null, true);
    updateLink();
  }

  function formatFrequencyMessage(text) {
    const regex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.+?): (.+)$/;
    const match = text.match(regex);
    if (match) {
        const [_, timestamp, username, message] = match;
        const sanitizedUsername = escapeHtml(username);
        const freqRegex = /\[FREQ:(\d+):([\w-]+)\]/;
        const freqMatch = message.match(freqRegex);
        if (freqMatch) {
            const [fullMatch, frequency, demodulation] = freqMatch;
            const sanitizedDemodulation = escapeHtml(demodulation);
            const [beforeFreq, afterFreq] = message.split(fullMatch).map(part => formatLinks(escapeHtml(part)));
            return {
                isFormatted: true,
                timestamp: escapeHtml(timestamp),
                username: sanitizedUsername,
                frequency: parseInt(frequency, 10),
                demodulation: sanitizedDemodulation,
                beforeFreq,
                afterFreq,
            };
        }
        return {
            isFormatted: false,
            timestamp: escapeHtml(timestamp),
            username: sanitizedUsername,
            parts: formatLinks(escapeHtml(message)),
        };
    }
    return {
        isFormatted: false,
        parts: formatLinks(escapeHtml(text)),
    };
}

  // Helper function to escape HTML special characters
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'link', content: match[0], url: match[0] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return parts;
  }

  function renderParts(parts) {
    return parts.map(part => {
      if (part.type === 'link') {
        return `<a href="${part.url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">${part.content}</a>`;
      }
      return part.content;
    }).join('');
  }

  onDestroy(() => {
    // Stop everything
    clearInterval(updateInterval);
    audio.stop();
    waterfall.stop();
    socket.close();
  });

  // Mobile gestures
  // Pinch = Mousewheel = Zoom
  let pinchX = 0;
  function handleWaterfallPinchStart(e) {
    pinchX = 0;
  }
  function handleWaterfallPinchMove(e) {
    const diff = e.detail.scale - pinchX;
    pinchX = e.detail.scale;
    const scale =
      1 -
      Math.abs(e.detail.srcEvent.movementX) /
        waterfallCanvas.getBoundingClientRect().width;
    const evt = e.detail.srcEvent;
    evt.coords = { x: e.detail.center.x };
    evt.deltaY = -Math.sign(diff);
    evt.scaleAmount = scale;
    waterfall.canvasWheel(evt);
    updatePassband();
    // Prevent mouseup event from firing
    waterfallDragTotal += 2;
  }
  // Pan = Mousewheel = waterfall dragging
  function handleWaterfallPanMove(e) {
    if (e.detail.srcEvent.pointerType === "touch") {
      waterfall.mouseMove(e.detail.srcEvent);
      updatePassband();
    }
  }
</script>

<svelte:window
  on:mousemove={handleWindowMouseMove}
  on:mouseup={handleWindowMouseUp}
/>

<main class="custom-scrollbar">
  <div class="h-screen overflow-hidden flex flex-col min-h-screen">
    
    <div
      class="w-full sm:h-screen overflow-y-scroll sm:w-1/2 xl:w-1/3 lg:w-1/4 sm:transition-all sm:ease-linear sm:duration-100"
      style="width:100%;"
    >
      <div
        class="min-h-screen bg-custom-dark text-gray-200"
        style="padding-top: 10px;"
      >
        <div class="max-w-screen-lg mx-auto">

          
     
      <div class="xl:pt-20"></div>
      <div
        style="image-rendering:pixelated;"
        class="w-full xl:rounded-lg   peer overflow-hidden"
        id="waterfall"
      >
        <canvas
          class="w-full  bg-black {waterfallDisplay ? 'block' : 'hidden'}"
          bind:this={waterfallCanvas}
          use:pinch
          on:pinchstart={handleWaterfallPinchStart}
          on:pinchmove={handleWaterfallPinchMove}
          use:pan
          on:panmove={handleWaterfallPanMove}
          on:wheel={handleWaterfallWheel}
          on:mousedown={handleWaterfallMouseDown}
          width="1024"
        ></canvas>
        <canvas class="hidden" bind:this={tempCanvas} width="1024" height="1024"
        ></canvas>
        <FrequencyInput
      bind:this={frequencyInputComponent}
      on:change={handleFrequencyChange}
    ></FrequencyInput>
    <canvas
      class="w-full bg-black peer {spectrumDisplay ? 'max-h-40' : 'max-h-0'}"
      bind:this={spectrumCanvas}
      on:wheel={handleWaterfallWheel}
      on:click={passbandTunerComponent.handlePassbandClick}
      width="1024"
      height="128"
    ></canvas>
    <FrequencyMarkers
    bind:this={frequencyMarkerComponent}
    on:click={passbandTunerComponent.handlePassbandClick}
    on:wheel={handleWaterfallWheel}
    on:markerclick={handleFrequencyMarkerClick}
  ></FrequencyMarkers>
  <canvas
  class="w-full bg-black peer"
  bind:this={graduationCanvas}
  on:wheel={handleWaterfallWheel}
  on:click={passbandTunerComponent.handlePassbandClick}
  on:mousedown={(e) => passbandTunerComponent.handleMoveStart(e, 1)}
  on:touchstart={passbandTunerComponent.handleTouchStart}
  on:touchmove={passbandTunerComponent.handleTouchMove}
  on:touchend={passbandTunerComponent.handleTouchEnd}
  width="1024"
  height="20"
></canvas>
    <PassbandTuner
      on:change={handlePassbandChange}
      on:wheel={handleWaterfallWheel}
      bind:this={passbandTunerComponent}
    ></PassbandTuner>
    <canvas
      class="w-full bg-black peer"
      bind:this={bandPlanCanvas}
      on:wheel={handleWaterfallWheel}
      on:click={passbandTunerComponent.handlePassbandClick}
      on:mousedown={(e) => passbandTunerComponent.handleMoveStart(e, 1)}
      on:touchstart={passbandTunerComponent.handleTouchStart}
      on:touchmove={passbandTunerComponent.handleTouchMove}
      on:touchend={passbandTunerComponent.handleTouchEnd}
      width="1024"
      height="20"
    >


      </div>

      	<div class="flex absolute inset-0 z-20 justify-center items-center bg-gray-800 bg-opacity-75 backdrop-filter backdrop-blur-sm"  id="startaudio">
        	<button class="text-white font-bold py-2 px-4 rounded">Start Audio</button>
      	</div>
      

          {#if showTutorial}
            <div
              class="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center"
              on:click={nextStep}
              transition:fade={{ duration: 300 }}
            >
              {#key currentStep}
                {#if highlightedElement}
                  <div
                    class="absolute bg-blue-500 bg-opacity-20 border-2 border-blue-500 transition-all duration-300 ease-in-out pointer-events-none"
                    style="
                    top: {highlightedElement.offsetTop}px;
                    left: {highlightedElement.offsetLeft}px;
                    width: {highlightedElement.offsetWidth}px;
                    height: {highlightedElement.offsetHeight}px;
                  "
                    transition:scale={{ duration: 300, start: 0.95 }}
                  ></div>
                {/if}
              {/key}
              <div
                class="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white p-6 rounded-lg shadow-lg max-w-md text-center backdrop-filter backdrop-blur-lg bg-opacity-80 border border-gray-700"
                transition:fly={{ y: 50, duration: 300 }}
              >
                <p class="mb-4 text-lg">{tutorialSteps[currentStep].content}</p>
                <div class="flex justify-between">
                  <button
                    class="px-6 py-2 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
                    on:click|stopPropagation={endTutorial}
                  >
                    Skip Tutorial
                  </button>
                  <button
                    class="px-6 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
                    on:click|stopPropagation={nextStep}
                  >
                    {currentStep < tutorialSteps.length - 1 ? "Next" : "Finish"}
                  </button>
                </div>
              </div>
            </div>
          {/if}

          <!-- alles neu  -->

          <div class="flex flex-col xl:flex-row rounded p-5 justify-center rounded"  id="middle-column">
            <div
              class="p-5 flex flex-col bg-gray-700 
                    border-b xl:border-b-0 xl:border-r border-gray-500 
                    xl:rounded-l-lg"
            >
            
              <h1 class="m-0">Audio</h1>
              <div class="control-group" id="volume-slider">
                <button
                  class="glass-button text-white font-bold rounded-full w-10 h-10 flex items-center justify-center"
                  on:click={handleMuteChange}
                >
                  {mute ? "🔇" : "🔊"}
                </button>
                <div class="slider-container">
                  <input
                    type="range"
                    bind:value={volume}
                    on:input={handleVolumeChange}
                    class="glass-slider"
                    disabled={mute}
                    min="0"
                    max="100"
                    step="1"
                  />
                </div>
                <span class="value-display text-gray-300">{volume}%</span>
              </div>

              <div class="control-group mt-12" id="squelch-slider">
                <button
                  class="glass-button text-white font-bold rounded-full w-10 h-10 flex items-center justify-center mt-1"
                  style="background: {squelchEnable
                    ? 'rgba(16, 185, 129, 0.2)'
                    : 'rgba(255, 255, 255, 0.05)'}"
                  on:click={handleSquelchChange}
                >
                  SQ
                </button>
                <div class="slider-container">
                  <input
                    type="range"
                    bind:value={squelch}
                    on:mousemove={handleSquelchMove}
                    class="glass-slider"
                    min="-150"
                    max="0"
                    step="1"
                  />
                </div>
                <span class="value-display text-gray-300">{squelch}db</span>
              </div>
              <!-- Decoder Options -->
              <div class="mt-5">
                <label class="block text-sm font-medium text-gray-300 mb-2">Decoder Options</label>
                <div class="flex justify-center gap-2">
                  <button
                    
                    class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center {!ft8Enabled ? 'active' : ''}"
                    on:click={(e) => handleFt8Decoder(e, false)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5 mr-2"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    None
                  </button>
                  <button
                  id="ft8-decoder"
                    class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center {ft8Enabled ? 'active' : ''}"
                    on:click={(e) => handleFt8Decoder(e, true)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5 mr-2"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    FT8
                  </button>
                </div>
              </div>

              <!-- FT8 Messages List -->
              {#if ft8Enabled}
              <div class="glass-panel rounded-lg p-3 mt-4 scrollbar-container" >
                <div class="flex justify-between items-center mb-2 text-sm">
                  <h4 class="text-white font-semibold">FT8 Messages</h4>
                  <span class="text-white" id="farthest-distance">Farthest: 0 km</span>
                </div>
                <div class="text-white overflow-auto max-h-40 custom-scrollbar pr-2">
                  <div id="ft8MessagesList">
                    <!-- Dynamic content populated here -->
                  </div>
                </div>
              </div>
              {/if}
            </div>

            <div class="flex flex-col items-center bg-gray-700 p-5">
              <div class="flex flex-col items-center xl:items-start xl:flex-row bg-black rounded-lg " id="smeter-tut">
                <div class="flex flex-col justify-center xl:ml-4 w-48 pt-2">
                  <input
                    class="text-4xl h-12 text-center bg-black text-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 rounded-lg mb-2"
                    type="text"
                    bind:value={frequency}
                    size="3"
                    name="frequency"
                    
                    on:keydown={(e) => {
                      if (e.key === 'Enter') {
                        frequencyInputComponent.setFrequency(frequency * 1e3);
                        handleFrequencyChange({ detail: frequency * 1e3 });
                      }
                    }}
                    use:handleWheel
                  />
                  <div class="flex items-center justify-center mb-4" id="bandwidth-display">
                    <p class="text-green-400 text-xs px-1">{demodulation}</p>
                    <p class="text-cyan-300 text-xs px-1">BW {bandwidth} kHz</p>
                  </div>
                </div>
                <!-- SMeter -->
                <div class="flex justify-center items-center xl:mt-6 xl:mb-0 mb-6">
                  <canvas id="sMeter" width="250" height="40"></canvas>
                </div>
              </div>
              <div id="frequencyContainer" class="w-full">
                <div class="mt-1" id="bandwidth-display">
                  <div class="flex flex-col items-center bg-gray-700">
                    <h3 class="text-white text-base mb-2">Demodulation</h3>

                    <div id="demodulator-select" class="flex flex-wrap justify-center w-full mb-2">
                      {#each ['USB', 'LSB', 'CW-U', 'CW-L', 'AM', 'FM'] as mode}
                        <button
                          on:click={() => SetMode(mode)}
                          class="retro-button text-white font-bold w-1/3 sm:w-16 h-8 text-sm rounded-md flex items-center justify-center m-1 border-1 border-gray-500 shadow-inner transition-all duration-200 ease-in-out {demodulation === mode ? 'bg-blue-600 pressed scale-95' : 'bg-gray-800 hover:bg-gray-700'}"
                        >
                          {mode}
                        </button>
                      {/each}
                    </div>
                  </div>
                  <h3 class="text-white text-base mb-2" >Zoom Controls</h3>
                  <div id="zoom-controls" class="flex justify-center w-full mb-2">
                    {#each [
                      { action: '+', title: 'Zoom in', icon: 'zoom-in', text: 'In' },
                      { action: '-', title: 'Zoom out', icon: 'zoom-out', text: 'Out' },
                      { action: 'max', title: 'Zoom to max', icon: 'maximize', text: 'Max' },
                      { action: 'min', title: 'Zoom to min', icon: 'minimize', text: 'Min' }
                    ] as { action, title, icon, text }}
                      <button
                        class="retro-button text-white font-bold w-16 h-8 text-xs rounded-md flex items-center justify-center m-1 border-1 border-gray-500 shadow-inner transition-all duration-200 ease-in-out bg-gray-800 hover:bg-gray-700"
                        on:click={(e) => handleWaterfallMagnify(e, action)}
                        {title}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4 mr-1"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          {#if icon === 'zoom-in'}
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="11" y1="8" x2="11" y2="14" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                          {:else if icon === 'zoom-out'}
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                          {:else if icon === 'maximize'}
                            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                          {:else if icon === 'minimize'}
                            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                          {/if}
                        </svg>
                        <span class="text-xs">{text}</span>
                      </button>
                    {/each}
                  </div>
                  <h3 class="text-white text-base mb-2">Misc</h3>
                  <div class="flex justify-center flex-wrap mt-1 w-full mb-2" id="moreoptions">
                    {#each ['NR', 'NB', 'AN', 'CTCSS'] as option}
                      <button
                        class="retro-button text-white font-bold w-16 h-8 text-xs rounded-md flex items-center justify-center m-1 border-1 border-gray-500 shadow-inner transition-all duration-200 ease-in-out {(option === 'NR' && NREnabled) || (option === 'NB' && NBEnabled) || (option === 'AN' && ANEnabled) || (option === 'CTCSS' && CTCSSSupressEnabled) ? 'bg-blue-600 pressed scale-95' : 'bg-gray-800 hover:bg-gray-700'}"
                        on:click={() => {
                          if (option === 'NR') handleNRChange();
                          else if (option === 'NB') handleNBChange();
                          else if (option === 'AN') handleANChange();
                          else handleCTCSSChange();
                        }}
                      >
                        {option}
                      </button>
                    {/each}
                  </div>
                  <h3 class="text-white text-base mb-2">Bandwidth</h3>
                  <div class="flex justify-center items-center flex-wrap mt-1 w-full mb-2">
                    {#each bandwithoffsets as bandwidthoffset (bandwidthoffset)}
                      <button
                        class="retro-button text-white font-bold w-14 h-8 text-xs rounded-md flex items-center justify-center m-1 border-1 border-gray-500 shadow-inner transition-all duration-200 ease-in-out {bandwidth === bandwidthoffset ? 'bg-blue-600 pressed scale-95' : 'bg-gray-800 hover:bg-gray-700'}"
                        on:click={(e) => handleBandwidthOffsetClick(e, bandwidthoffset)}
                        title="{bandwidthoffset} kHz"
                      >
                        {bandwidthoffset}
                      </button>
                    {/each}
                  </div>
                  
                </div>
              </div>
            </div>

            <div
              class="flex flex-col bg-gray-700 p-5 xl:border-l border-t border-gray-500 xl:rounded-r-lg"
            >
              <h1>Waterfall</h1>

              <div class="flex items-center justify-between" id="brightness-controls">
                <span class="text-gray-300 text-sm w-10 text-left">Min:</span>
                <div class="slider-container w-32 mx-4">
                  <input
                    type="range"
                    bind:value={min_waterfall}
                    min="-100"
                    max="255"
                    step="1"
                    class="glass-slider w-full"
                    on:input={handleMinMove}
                  />
                </div>
                <span class="value-display text-gray-300 w-10 text-right"
                  >{min_waterfall}</span
                >
              </div>
              <div class="flex items-center justify-between">
                <span class="text-gray-300 text-sm w-10 text-left">Max:</span>
                <div class="slider-container w-32 mx-4">
                  <input
                    id="brightness-controls"
                    type="range"
                    bind:value={max_waterfall}
                    min="0"
                    max="255"
                    step="1"
                    class="glass-slider w-full"
                    on:input={handleMaxMove}
                  />
                </div>
                <span class="value-display text-gray-300 w-10 text-right"
                  >{max_waterfall}</span
                >
              </div>

              <div class="flex justify-between mt-4" id="colormap-select">
                <span class="text-sm text-gray-300 block">Colormap:</span>
                <div class="relative inline-block w-24 text-sm">
                  <select
                    bind:value={currentColormap}
                    on:change={handleWaterfallColormapSelect}
                    class="glass-select block w-full pl-3 pr-10 text-sm rounded-lg text-gray-200 appearance-none focus:outline-none"
                  >
                    {#each availableColormaps as colormap}
                      <option value={colormap}>{colormap}</option>
                    {/each}
                  </select>
                  <div
                    class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400"
                  >
                    <svg
                      class="fill-current h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                    >
                      <path
                        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <!-- Toggle Switches -->
              <div class="flex flex-wrap justify-between mt-5">
                <div class="flex flex-col items-center mr-4" id="auto-adjust">
                  <span class="text-sm text-gray-300 mb-1">Auto Adjust</span>
                  <label class="toggle-switch">
                    <input type="checkbox" bind:checked={autoAdjust} on:change={() => handleAutoAdjust(autoAdjust)}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              
                <div class="flex flex-col items-center mr-4" id="spectrum-toggle">
              
                  <span class="text-sm text-gray-300 mb-1">Spectrum</span>
                  <label class="toggle-switch">
                    <input type="checkbox" on:change={handleSpectrumChange}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              
                <div class="flex flex-col items-center" id="bigger-waterfall">
                  <span class="text-sm text-gray-300 mb-1">Bigger Waterfall</span>
                  <label class="toggle-switch">
                    <input type="checkbox" on:change={handleWaterfallSizeChange}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>

                <!-- Bookmark button -->
                  <button
                  class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center mt-6"
                  id="bookmark-button"
                  on:click={toggleBookmarkPopup}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 mr-2"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                  </svg>
                  Bookmarks
                </button>

                <span id="total_user_count" class="pt-4">Empty</span>

                <!-- Bookmark Popup -->
                {#if showBookmarkPopup}
                <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div class="bg-gray-800 p-6 rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
                    <div class="flex justify-between items-center mb-4">
                      <h2 class="text-xl font-bold text-white">Bookmarks</h2>
                      <button class="text-gray-400 hover:text-white" on:click={toggleBookmarkPopup}>
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                      </button>
                    </div>
              
                    <!-- Add Bookmark Section -->
                    <div class="mb-6">
                      <label class="block text-sm font-medium text-gray-300 mb-2">Add New Bookmark</label>
                      <div class="flex items-center gap-2">
                        <input
                          class="glass-input text-white text-sm rounded-lg focus:outline-none px-3 py-2 flex-grow"
                          bind:value={newBookmarkName}
                          placeholder="Bookmark name"
                        />
                        <button
                          class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center"
                          on:click={addBookmark}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 mr-2"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                              clip-rule="evenodd"
                            />
                          </svg>
                          Add
                        </button>
                      </div>
                    </div>
              
                    <!-- Current Link Section -->
                    <div class="mb-6">
                      <label class="block text-sm font-medium text-gray-300 mb-2">Current Link</label>
                      <div class="flex items-center gap-2">
                        <input
                          type="text"
                          class="glass-input text-white text-sm rounded-lg focus:outline-none px-3 py-2 flex-grow"
                          value={link}
                          readonly
                        />
                        <button
                          class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center"
                          on:click={handleLinkCopyClick}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 mr-2"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                          </svg>
                          Copy
                        </button>
                      </div>
                    </div>
              
                    <!-- Bookmarks List -->
                    <div class="overflow-y-auto flex-grow h-80">
                      <label class="block text-sm font-medium text-gray-300 mb-2">Saved Bookmarks</label>
                      {#each $bookmarks as bookmark, index}
                        <div class="glass-panel rounded-lg p-3 flex items-center justify-between mb-2">
                          <div class="flex flex-col">
                            <span class="text-white text-sm">{bookmark.name}</span>
                            <span class="text-gray-400 text-xs">{(bookmark.frequency / 1000).toFixed(3)} kHz</span>
                          </div>
                          <div class="flex gap-2">
                            <button
                              class="glass-button text-white font-bold py-1 px-3 rounded-lg flex items-center"
                              on:click={() => goToBookmark(bookmark)}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4 mr-1"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fill-rule="evenodd"
                                  d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                              Go
                            </button>
                            <button
                              class="glass-button text-white font-bold py-1 px-3 rounded-lg flex items-center"
                              on:click={() => copy(bookmark.link)}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4 mr-1"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                              </svg>
                              Copy
                            </button>
                            <button
                              class="glass-button text-white font-bold py-1 px-3 rounded-lg flex items-center"
                              on:click={() => deleteBookmark(index)}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4 mr-1"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fill-rule="evenodd"
                                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                              Delete
                            </button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>
                </div>
              {/if}
             
        
              
            

              
            </div>
          </div>
          
          <!-- Chat box -->
          <div class="flex justify-center w-full">
          <div class="bg-gray-700 rounded-lg p-4 mb-48 xl:mb-8 w-full" id="chat-box" >
            <h3 class="text-white text-lg mb-2">Chat</h3>

            <!-- Username Input -->
            <div class="flex items-center justify-center space-x-2 mb-2 username-container">
              {#if showUsernameInput}
                <div>
                  <input
                    class="glass-input text-white p-2 rounded-lg outline-none text-sm flex-grow"
                    bind:value={username}
                    placeholder="Name/callsign"
                    on:keydown={(e) => e.key === 'Enter' && saveUsername()}
                  />
                </div>
                <button
                  class="glass-button text-white p-2 rounded-lg flex items-center justify-center"
                  on:click={saveUsername}
                  title="Save username"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                </button>
              {:else}
                <div class="flex items-center">
                  <span class="glass-username text-white text-sm px-3 py-1 rounded-lg mr-2" title={username}>
                    {username || 'Anonymous'}
                  </span>
                  <button
                    class="glass-button text-white p-2 rounded-lg flex items-center justify-center"
                    on:click={editUsername}
                    title="Edit username"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                </div>
              {/if}
            </div>
          
            <!-- Chat Messages Container -->
            <div class="custom-scrollbar overflow-auto h-48 mb-2" id="chat_content">
              {#each $messages as { id, text } (id)}
                {@const formattedMessage = formatFrequencyMessage(text)}
                <div class="flex mb-1">
                  <div class="glass-message p-1 rounded-lg bg-gray-600 bg-opacity-20 max-w-full">
                    <p class="text-xs text-gray-400 mb-0.5 text-left">
                      {formattedMessage.timestamp}
                    </p>
                    <p class="text-white text-xs break-words">
                      <span class="font-semibold">{formattedMessage.username}: </span>
                      {#if formattedMessage.isFormatted}
                        {@html renderParts(formattedMessage.beforeFreq)}
                        <a
                          href="#"
                          class="text-blue-300 hover:underline"
                          on:click|preventDefault={() =>
                            handleFrequencyClick(
                              formattedMessage.frequency,
                              formattedMessage.demodulation,
                            )}
                        >
                          {(formattedMessage.frequency / 1000).toFixed(3)}
                          kHz ({formattedMessage.demodulation})
                        </a>
                        {@html renderParts(formattedMessage.afterFreq)}
                      {:else}
                        {@html renderParts(formattedMessage.parts)}
                      {/if}
                    </p>
                  </div>
                </div>
              {/each}
            </div>
          
            <!-- Message Input and Buttons -->
            <div class="flex flex-col space-y-2" >
              <input
                class="glass-input text-white p-2 rounded-lg outline-none text-sm w-full"
                bind:value={newMessage}
                on:keydown={handleEnterKey}
                placeholder="Type a message..."
              />
              <div class="flex space-x-2">
                <button
                  class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center flex-1 text-sm"
                  on:click={sendMessage}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4 mr-2"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"
                    />
                  </svg>
                  Send
                </button>
                <button
                  class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center flex-1 text-sm"
                  on:click={pasteFrequency}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4 mr-2"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                    <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                  </svg>
                  Paste Freq
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
        </div>
      </div>
  </div>
</main>

<svelte:head>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
</svelte:head>

<style global lang="postcss">
  :root {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
      Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
  }

  @media (min-width: 1200px) {
    #chat-box {
      min-width: var(--middle-column-width);
    }
  }

  .full-screen-container {
    display: flex;
    flex-direction: row;
    height: 100vh;
  }

  .side-nav {
    flex-basis: 250px; 
    overflow-y: auto;
    background-color: #333;
    color: #fff;
  }

  .main-content {
    flex-grow: 1;
    overflow-y: auto;
    padding: 20px;
    max-width: 1200px; 
    margin: auto;
  }

  .tab-content {
    display: none; 
  }

  .tab-content.active {
    display: block; 
  }

  :global(body.light-mode) {
    background-color: #a9a9a9;
    transition: background-color 0.3s;
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


  .custom-scrollbar::-webkit-scrollbar {
    width: 12px;
    background-color: transparent;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    background-color: rgba(255, 255, 255, 0.05);
    border-radius: 10px;
    margin: 5px 0;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 10px;
    border: 3px solid rgba(0, 0, 0, 0.2);
    background-clip: padding-box;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.3);
  }


  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.05);
  }


  .scrollbar-container {
    padding-right: 12px;
    box-sizing: content-box;
  }

  .bg-custom-dark {
    background: linear-gradient(135deg, #1a1c2e, #2a2c3e);
  }

  .glass-username {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(5px);
    display: inline-block;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .glass-button {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  }

  .glass-button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .glass-slider {
    -webkit-appearance: none;
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
    border-radius: 3px;
  }

  .glass-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    background: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    border-radius: 50%;
  }

  #sMeter {
    width: 300px;
    height: 40px;
    background-color: transparent;
    display: block;
    margin-left: 30px;
    margin-top: 5px;
  }

  .smeter-container {
    background-color: black;
    padding: 10px;
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 310px;
    padding: 15px;
    background: #111;
    border-radius: 5px;
    position: relative;
    margin: 0 auto;
    box-shadow: 0 0 10px rgb(83 83 83 / 30%);
    font-family: "VT323", monospace;
  }

  .glass-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    border-radius: 50%;
  }

  .glass-message {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: background-color 0.3s;
  }

  .glass-message:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .glass-panel {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    transition: all 0.3s ease;
  }

  .glass-panel:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateY(-5px);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
  }

  .glass-input {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(5px);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .control-group {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
  }

  .slider-container {
    flex-grow: 1;
    margin: 0 15px;
    width: 200px;
  }

  .value-display {
    width: 50px;
    text-align: right;
  }

  .glass-button.active {
    background: linear-gradient(
      135deg,
      rgba(50, 50, 80, 0.8),
      rgba(60, 50, 80, 0.8)
    );
    border-color: rgba(120, 100, 180, 0.4);
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.2),
      inset 0 1px 2px rgba(150, 130, 200, 0.1);
  }

  .glass-select {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  }

  .glass-select:focus {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(99, 102, 241, 0.5);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
  }

  .glass-select option {
    background-color: #2a2c3e;
  }

  .glass-toggle-button {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
    min-width: 48px;
  }

  .glass-toggle-button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .glass-toggle-button.active {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.4);
  }

  .slide-transition {
    transition: max-height 300ms cubic-bezier(0.23, 1, 0.32, 1);
    overflow: hidden;
  }

  .chat-input {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-color: rgba(255, 255, 255, 0.1) !important;
    color: white !important;
    border: 1px solid rgba(255, 255, 255, 0.2) !important;
  }

  .chat-input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .chat-button {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-color: rgba(255, 255, 255, 0.1) !important;
    color: white !important;
    border: 1px solid rgba(255, 255, 255, 0.2) !important;
    font-size: 14px;
  }

  @supports (-webkit-touch-callout: none) {
    .chat-input,
    .chat-button {
      background-color: rgba(255, 255, 255, 0.1) !important;
      color: white !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
    }
  }



  .toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px; 
  height: 22px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #676767;
  transition: .4s;
  border-radius: 22px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;  
  left: 2px;   
  bottom: 2px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: #2196F3;
}

input:focus + .toggle-slider {
  box-shadow: 0 0 1px #2196F3;
}

input:checked + .toggle-slider:before {
  transform: translateX(18px);
}
</style>
