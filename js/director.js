/**
 * VALORA AI — EMOTION & VOICE DIRECTOR MODULE
 * Brand: VALORA AI - Give every voice a presence.
 * Features: Multi-Emotion Directability, Delivery Styles, Intensity Scaling,
 *           Pitch-Preserving Speed, Preview & Full Generation, Acoustic Visualizer.
 */

(function () {
  'use strict';

  // Module State
  const state = {
    activeVoiceId: 'v2/en_speaker_6',
    activeEmotion: 'neutral',
    activeStyle: 'natural',
    intensity: 50,
    speed: 1.0,
    scriptText: '',
    isGenerating: false,
    isPlaying: false,
    currentTime: 0,
    totalDuration: 0,
    lastGeneratedSettings: null,
    currentBlob: null,
    currentUrl: null,
    currentMp3Blob: null,
    currentMp3Url: null,
    currentTakeId: null,
    isConvertingMp3: false,
    sessionTakes: [],
    isBackendConnected: true,
  };

  function triggerFileDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  let audioElement = null;
  let visualizerAnimId = null;

  // -------------------------------------------------------------------------
  // Sample Scripts Library
  // -------------------------------------------------------------------------
  const SAMPLE_SCRIPTS = {
    primary: 'Welcome to Valora AI Voice Director. This is an expressive neural speech showcase featuring dynamic emotional directability, delivery styles, and high-fidelity acoustics.',
    monologue: 'The storm has finally cleared, leaving behind a silence so profound you can hear the beating of your own heart. We survived against all odds.',
    story: 'Once upon a quiet winter evening, beneath an emerald sky of dancing auroras, the old lighthouse began to hum with an unearthly melody.',
    promo: 'Introducing Valora AI — real-time neural voice generation built for next-generation creators, storytellers, and audio architects.',
    calm: 'Close your eyes and breathe in slowly. Release all tension from your shoulders, and allow your thoughts to drift away like gentle clouds.'
  };

  // -------------------------------------------------------------------------
  // Combination Descriptions
  // -------------------------------------------------------------------------
  const COMBO_DESCRIPTIONS = {
    'neutral+natural': 'Standard balanced delivery using pure voice baseline acoustic parameters.',
    'neutral+whispering': 'Neutral tone delivered with intimate close-mic whispering breathiness.',
    'neutral+storytelling': 'Narrative pacing and deliberate phrasing with neutral emotional coloring.',
    'neutral+energetic': 'Brisk, punchy projection with neutral baseline pitch.',
    'happy+natural': 'Uplifting, optimistic tone with bright pitch and natural conversational pacing.',
    'happy+storytelling': 'Warm, joyful narrative delivery with expressive melodic pitch contours.',
    'happy+energetic': 'High-spirited, radiant performance with brisk tempo and vibrant acoustic projection.',
    'happy+whispering': 'Playful, cheerful whisper with close-mic intimacy and soft treble presence.',
    'sad+natural': 'Melancholic, poignant delivery with lowered pitch and slower cadence.',
    'sad+storytelling': 'Somber, reflective narrative pacing with deep emotional gravity.',
    'sad+whispering': 'Quiet, vulnerable acoustic presence with delicate breath dynamics.',
    'sad+energetic': 'Urgent, distressed emotional delivery with elevated tension.',
    'confident+natural': 'Authoritative, clear resonance and steady, grounded presence.',
    'confident+storytelling': 'Compelling, commanding narrative delivery with executive poise.',
    'confident+energetic': 'High-momentum, assertive projection with punchy attack and clear diction.',
    'confident+whispering': 'Secretive, firm whisper with focused presence and crisp consonants.',
    'calm+natural': 'Serene, soothing, relaxed pace with smooth harmonic resonance.',
    'calm+storytelling': 'Gentle, hypnotic narrative cadence ideal for meditation or reflective prose.',
    'calm+whispering': 'Tranquil, meditative whisper with relaxed breathiness and serene warmth.',
    'calm+energetic': 'Harmonious yet lively delivery with balanced warmth and positive tempo.',
    'angry+natural': 'Forceful, sharp tension with rapid dynamic attack and biting edge.',
    'angry+storytelling': 'Intense dramatic narrative phrasing with building suspense and grit.',
    'angry+energetic': 'Maximum acoustic intensity with rapid cadence and aggressive vocal drive.',
    'angry+whispering': 'Tense, suppressed rage delivered as an intense stage whisper.'
  };

  // -------------------------------------------------------------------------
  // Helper: Toast Notifications
  // -------------------------------------------------------------------------
  function notify(msg, type = 'info') {
    if (window.ValoraApp && typeof window.ValoraApp.showToast === 'function') {
      window.ValoraApp.showToast(msg, type);
    } else {
      console.log(`[Director ${type.toUpperCase()}]: ${msg}`);
    }
  }

  // -------------------------------------------------------------------------
  // Helper: Format Seconds as M:SS
  // -------------------------------------------------------------------------
  function formatSeconds(sec) {
    if (isNaN(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // -------------------------------------------------------------------------
  // Helper: Get Voice Catalog
  // -------------------------------------------------------------------------
  function getVoiceCatalog() {
    if (window.ValoraApp && typeof window.ValoraApp.getVoices === 'function') {
      const v = window.ValoraApp.getVoices();
      if (Array.isArray(v) && v.length > 0) return v;
    }
    return [
      { id: 'v2/en_speaker_6', name: 'Aria Vance', accent: 'American English', gender: 'Female', gradient: 'grad-voice-indigo', icon: 'fa-microphone-lines' },
      { id: 'v2/en_speaker_0', name: 'Guy Hawkins', accent: 'American English', gender: 'Male', gradient: 'grad-voice-cyan', icon: 'fa-volume-high' },
      { id: 'v2/en_speaker_1', name: 'Jenny Adams', accent: 'American English', gender: 'Female', gradient: 'grad-voice-violet', icon: 'fa-chart-simple' },
      { id: 'v2/en_speaker_2', name: 'Sonia Sterling', accent: 'British English', gender: 'Female', gradient: 'grad-voice-rose', icon: 'fa-music' },
      { id: 'indic_rohit', name: 'Rohit Verma (Indic-Parler-TTS)', accent: 'Hindi (India)', gender: 'Male', gradient: 'grad-voice-cyan', icon: 'fa-microphone-lines' },
      { id: 'indic_divya', name: 'Divya Sharma (Indic-Parler-TTS)', accent: 'Hindi (India)', gender: 'Female', gradient: 'grad-voice-pink', icon: 'fa-heart' }
    ];
  }

  // -------------------------------------------------------------------------
  // Populate Voice Selector
  // -------------------------------------------------------------------------
  function populateVoiceSelector() {
    const select = document.getElementById('director-voice-select');
    if (!select) return;

    const voices = getVoiceCatalog();
    const currentVal = state.activeVoiceId || select.value || voices[0].id;
    select.innerHTML = '';

    const hindiGroup = document.createElement('optgroup');
    hindiGroup.label = '🇮🇳 Hindi & Indic AI Voices (AI4Bharat / Neural)';

    const intlGroup = document.createElement('optgroup');
    intlGroup.label = '🌐 International Neural Voices';

    voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name} (${v.accent || v.language || 'Neural'} - ${v.gender || 'Neural'})`;
      if (v.id === currentVal) opt.selected = true;

      const isIndic = v.id.startsWith('indic_') || v.id.includes('/hi_') || (v.accent && v.accent.toLowerCase().includes('hindi'));
      if (isIndic) {
        hindiGroup.appendChild(opt);
      } else {
        intlGroup.appendChild(opt);
      }
    });

    if (hindiGroup.children.length > 0) select.appendChild(hindiGroup);
    if (intlGroup.children.length > 0) select.appendChild(intlGroup);

    select.value = currentVal;
    state.activeVoiceId = currentVal;
    updateActiveVoicePreview();
  }

  // -------------------------------------------------------------------------
  // Update Voice Preview Badge
  // -------------------------------------------------------------------------
  function updateActiveVoicePreview() {
    const voices = getVoiceCatalog();
    const voice = voices.find((v) => v.id === state.activeVoiceId) || voices[0];
    if (!voice) return;

    const nameEl = document.getElementById('director-sel-name');
    const metaEl = document.getElementById('director-sel-meta');
    const avatarEl = document.getElementById('director-sel-avatar');

    if (nameEl) nameEl.textContent = voice.name;
    if (metaEl) metaEl.textContent = `${voice.accent || voice.language || 'English'} • ${voice.gender || 'Female'} • ${voice.category || 'Neural Voice'}`;
    if (avatarEl) {
      avatarEl.className = `director-voice-avatar ${voice.gradient || 'grad-voice-indigo'}`;
      avatarEl.innerHTML = `<i class="fa-solid ${voice.icon || 'fa-microphone-lines'}"></i>`;
    }
  }

  // -------------------------------------------------------------------------
  // Update Combination Banner
  // -------------------------------------------------------------------------
  function updateCombinationBanner() {
    const tagEl = document.getElementById('director-combo-tag');
    const descEl = document.getElementById('director-combo-desc');
    if (!tagEl || !descEl) return;

    const emotion = state.activeEmotion || 'neutral';
    const style = state.activeStyle || 'natural';

    const emoTitle = emotion.charAt(0).toUpperCase() + emotion.slice(1);
    const styleTitle = style.charAt(0).toUpperCase() + style.slice(1);

    tagEl.textContent = `${emoTitle} + ${styleTitle}`;

    const key = `${emotion}+${style}`;
    descEl.textContent = COMBO_DESCRIPTIONS[key] || `Combines ${emoTitle} emotion with ${styleTitle} delivery style.`;
  }

  // -------------------------------------------------------------------------
  // Check if Settings Have Changed Since Last Generation
  // -------------------------------------------------------------------------
  function checkSettingsChanged() {
    const banner = document.getElementById('director-settings-changed-banner');
    if (!banner) return;

    if (!state.lastGeneratedSettings || !state.currentUrl) {
      banner.style.display = 'none';
      return;
    }

    const last = state.lastGeneratedSettings;
    const textInput = document.getElementById('director-script-input');
    const currentText = textInput ? textInput.value.trim() : '';

    const hasChanged = (
      last.voiceId !== state.activeVoiceId ||
      last.emotion !== state.activeEmotion ||
      last.style !== state.activeStyle ||
      last.intensity !== state.intensity ||
      Math.abs(last.speed - state.speed) > 0.01 ||
      (last.isFullScript && last.text !== currentText)
    );

    banner.style.display = hasChanged ? 'flex' : 'none';
  }

  // -------------------------------------------------------------------------
  // Reset Settings (Without Clearing Script)
  // -------------------------------------------------------------------------
  function resetSettings() {
    state.activeEmotion = 'neutral';
    state.activeStyle = 'natural';
    state.intensity = 50;
    state.speed = 1.0;

    // Reset Emotion Buttons
    document.querySelectorAll('#director-emotion-container .emotion-card-btn').forEach((btn) => {
      const isNeutral = btn.getAttribute('data-emotion') === 'neutral';
      btn.classList.toggle('active', isNeutral);
      btn.setAttribute('aria-checked', isNeutral ? 'true' : 'false');
    });

    // Reset Delivery Style Buttons
    document.querySelectorAll('#director-delivery-container .delivery-card-btn').forEach((btn) => {
      const isNatural = btn.getAttribute('data-style') === 'natural';
      btn.classList.toggle('active', isNatural);
      btn.setAttribute('aria-checked', isNatural ? 'true' : 'false');
    });

    // Reset Intensity Slider (disabled for Neutral)
    const intensitySlider = document.getElementById('director-intensity-slider');
    const intensityVal = document.getElementById('director-intensity-val');
    const intensityBox = document.getElementById('director-intensity-box');
    const intensityMsg = document.getElementById('director-intensity-disabled-msg');

    if (intensitySlider) {
      intensitySlider.value = 50;
      intensitySlider.disabled = true;
    }
    if (intensityVal) intensityVal.textContent = '50%';
    if (intensityBox) intensityBox.classList.add('disabled');
    if (intensityMsg) intensityMsg.style.display = 'block';

    // Reset Speed Slider
    const speedSlider = document.getElementById('director-speed-slider');
    const speedVal = document.getElementById('director-speed-val');
    if (speedSlider) speedSlider.value = 1.0;
    if (speedVal) speedVal.textContent = '1.0×';

    updateCombinationBanner();
    checkSettingsChanged();
    notify('Settings restored: Neutral emotion, Natural delivery, and 1.0× speed (script preserved).', 'info');
  }

  // -------------------------------------------------------------------------
  // Audio Player & Waveform Visualizer
  // -------------------------------------------------------------------------
  function initAudioPlayer() {
    if (!audioElement) {
      audioElement = new Audio();
    }

    const playBtn = document.getElementById('btn-director-play');
    const playIcon = document.getElementById('director-play-icon');
    const scrubber = document.getElementById('director-audio-scrubber');
    const curTimeEl = document.getElementById('director-cur-time');
    const totalTimeEl = document.getElementById('director-total-time');
    const rewindBtn = document.getElementById('btn-director-rewind');
    const forwardBtn = document.getElementById('btn-director-forward');
    const downloadBtn = document.getElementById('btn-director-download');
    const copyScriptBtn = document.getElementById('btn-director-copy-script');

    // Play / Pause Toggle
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (!state.currentUrl) {
          notify('Generate speech or preview first to play audio.', 'info');
          return;
        }

        if (state.isPlaying) {
          audioElement.pause();
        } else {
          audioElement.play().catch((err) => {
            console.error('Audio play error:', err);
            notify('Audio playback failed.', 'error');
          });
        }
      });
    }

    // Audio Element Event Listeners
    audioElement.addEventListener('play', () => {
      state.isPlaying = true;
      if (playIcon) playIcon.className = 'fa-solid fa-pause';
      startWaveformAnimation();
    });

    audioElement.addEventListener('pause', () => {
      state.isPlaying = false;
      if (playIcon) playIcon.className = 'fa-solid fa-play';
      stopWaveformAnimation();
    });

    audioElement.addEventListener('ended', () => {
      state.isPlaying = false;
      if (playIcon) playIcon.className = 'fa-solid fa-play';
      if (scrubber) scrubber.value = 0;
      if (curTimeEl) curTimeEl.textContent = '0:00';
      stopWaveformAnimation();
    });

    audioElement.addEventListener('timeupdate', () => {
      const cur = audioElement.currentTime;
      const dur = audioElement.duration || state.totalDuration || 0;
      if (curTimeEl) curTimeEl.textContent = formatSeconds(cur);
      if (dur > 0) {
        if (totalTimeEl) totalTimeEl.textContent = formatSeconds(dur);
        if (scrubber) scrubber.value = (cur / dur) * 100;
      }
    });

    audioElement.addEventListener('loadedmetadata', () => {
      const dur = audioElement.duration;
      if (dur && !isNaN(dur) && dur > 0) {
        state.totalDuration = dur;
        if (totalTimeEl) totalTimeEl.textContent = formatSeconds(dur);
      }
    });

    // Seek scrubber
    if (scrubber) {
      scrubber.addEventListener('input', () => {
        const dur = audioElement.duration || state.totalDuration || 0;
        if (dur > 0) {
          audioElement.currentTime = (scrubber.value / 100) * dur;
        }
      });
    }

    // Rewind 5s
    if (rewindBtn) {
      rewindBtn.addEventListener('click', () => {
        if (audioElement) audioElement.currentTime = Math.max(0, audioElement.currentTime - 5);
      });
    }

    // Forward 5s
    if (forwardBtn) {
      forwardBtn.addEventListener('click', () => {
        if (audioElement && audioElement.duration) {
          audioElement.currentTime = Math.min(audioElement.duration, audioElement.currentTime + 5);
        }
      });
    }

    // Download WAV
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        if (!state.currentBlob && !state.currentUrl) return;
        const vName = (state.activeVoiceId || 'voice').replace(/[^a-zA-Z0-9_-]/g, '_');
        triggerFileDownload(state.currentUrl, `valora-director-${state.activeEmotion}-${vName}.wav`);
        notify('24kHz Neural WAV file downloaded successfully.', 'success');
      });
    }

    // Download MP3
    const downloadMp3Btn = document.getElementById('btn-director-download-mp3');
    if (downloadMp3Btn) {
      downloadMp3Btn.addEventListener('click', async () => {
        if (!state.currentBlob && !state.currentUrl) return;
        if (state.isConvertingMp3) return;

        const vName = (state.activeVoiceId || 'voice').replace(/[^a-zA-Z0-9_-]/g, '_');
        const mp3Filename = `valora-director-${state.activeEmotion}-${vName}.mp3`;

        // Check if already cached
        if (state.currentMp3Url) {
          triggerFileDownload(state.currentMp3Url, mp3Filename);
          notify('192kbps MP3 audio downloaded successfully.', 'success');
          return;
        }

        // Run conversion
        state.isConvertingMp3 = true;
        const origHtml = '<i class="fa-solid fa-file-audio"></i> Download MP3';
        downloadMp3Btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing MP3…';
        downloadMp3Btn.disabled = true;

        try {
          const resp = await fetch('/api/tts/convert-mp3', {
            method: 'POST',
            headers: { 'Content-Type': 'audio/wav' },
            body: state.currentBlob,
          });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

          const blob = await resp.blob();
          const typedBlob = new Blob([blob], { type: 'audio/mpeg' });
          const mp3Url = URL.createObjectURL(typedBlob);

          state.currentMp3Blob = typedBlob;
          state.currentMp3Url = mp3Url;

          // If current take exists, cache on take
          if (state.currentTakeId) {
            const currentTake = state.sessionTakes.find((t) => t.id === state.currentTakeId);
            if (currentTake) {
              currentTake.mp3Blob = typedBlob;
              currentTake.mp3Url = mp3Url;
            }
          }

          triggerFileDownload(mp3Url, mp3Filename);
          downloadMp3Btn.innerHTML = origHtml;
          downloadMp3Btn.disabled = false;
          notify('192kbps MP3 audio downloaded successfully.', 'success');
        } catch (err) {
          console.error('Director MP3 conversion failed:', err);
          downloadMp3Btn.innerHTML = '<i class="fa-solid fa-arrow-rotate-right"></i> Retry MP3';
          downloadMp3Btn.disabled = false;
          notify('Failed to convert MP3. Click Retry MP3 to try again.', 'error');
        } finally {
          state.isConvertingMp3 = false;
        }
      });
    }

    // Copy Script
    if (copyScriptBtn) {
      copyScriptBtn.addEventListener('click', () => {
        const textInput = document.getElementById('director-script-input');
        const text = textInput ? textInput.value.trim() : '';
        if (!text) {
          notify('Script input is empty.', 'info');
          return;
        }
        navigator.clipboard.writeText(text).then(() => {
          notify('Script copied to clipboard!', 'success');
        }).catch(() => {
          notify('Could not copy to clipboard.', 'error');
        });
      });
    }

    drawIdleWaveform();
  }

  // Load a generated take into player
  function loadAudioTake(url, blob, duration, takeId = null) {
    state.currentUrl = url;
    state.currentBlob = blob;
    state.currentTakeId = takeId;

    if (takeId) {
      const take = state.sessionTakes.find((t) => t.id === takeId);
      if (take && take.mp3Url) {
        state.currentMp3Blob = take.mp3Blob;
        state.currentMp3Url = take.mp3Url;
      } else {
        state.currentMp3Blob = null;
        state.currentMp3Url = null;
      }
    } else {
      state.currentMp3Blob = null;
      state.currentMp3Url = null;
    }
    state.isConvertingMp3 = false;

    if (duration && !isNaN(duration) && duration > 0) {
      state.totalDuration = duration;
      const totalTimeEl = document.getElementById('director-total-time');
      if (totalTimeEl) totalTimeEl.textContent = formatSeconds(duration);
    }

    if (audioElement) {
      audioElement.src = url;
      audioElement.play().catch(() => {});
    }

    // Enable download & copy buttons
    const downloadBtn = document.getElementById('btn-director-download');
    const downloadMp3Btn = document.getElementById('btn-director-download-mp3');
    const copyScriptBtn = document.getElementById('btn-director-copy-script');
    if (downloadBtn) downloadBtn.disabled = false;
    if (downloadMp3Btn) {
      downloadMp3Btn.disabled = false;
      downloadMp3Btn.innerHTML = '<i class="fa-solid fa-file-audio"></i> Download MP3';
    }
    if (copyScriptBtn) copyScriptBtn.disabled = false;

    // Hide offline setup state if it was showing
    const setupCard = document.getElementById('director-setup-card');
    if (setupCard) setupCard.style.display = 'none';

    // Update status pill to active
    const statusText = document.getElementById('director-status-text');
    const statusPill = document.getElementById('director-status-pill');
    if (statusText) statusText.textContent = 'Audio Master Ready';
    if (statusPill) statusPill.classList.remove('offline');

    // Update format badge to accurately reflect actual sample rate and model architecture
    const formatEl = document.getElementById('director-player-format');
    if (formatEl) {
      const isIndic = state.activeVoiceId && state.activeVoiceId.startsWith('indic_');
      formatEl.textContent = isIndic ? '44.1kHz Indic WAV' : '24kHz Neural WAV';
    }

    checkSettingsChanged();
  }

  // -------------------------------------------------------------------------
  // Waveform Visualizer Canvas
  // -------------------------------------------------------------------------
  function drawIdleWaveform() {
    const canvas = document.getElementById('director-waveform-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const barCount = 36;
    const barWidth = 6;
    const gap = (w - (barCount * barWidth)) / (barCount + 1);

    for (let i = 0; i < barCount; i++) {
      const x = gap + i * (barWidth + gap);
      const normalizedHeight = 0.2 + 0.3 * Math.sin((i / barCount) * Math.PI);
      const barH = h * normalizedHeight;
      const y = (h - barH) / 2;

      ctx.fillStyle = isDark ? '#2E323B' : '#E2E0D8';
      ctx.fillRect(x, y, barWidth, barH);
    }
  }

  function startWaveformAnimation() {
    stopWaveformAnimation();
    const canvas = document.getElementById('director-waveform-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let phase = 0;

    function renderFrame() {
      if (!state.isPlaying) return;
      phase += 0.12;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const barCount = 36;
      const barWidth = 6;
      const gap = (w - (barCount * barWidth)) / (barCount + 1);

      for (let i = 0; i < barCount; i++) {
        const x = gap + i * (barWidth + gap);
        // Harmonic motion
        const wave1 = Math.sin(phase + i * 0.45);
        const wave2 = Math.cos(phase * 1.3 + i * 0.2);
        const waveVal = Math.abs(wave1 * 0.6 + wave2 * 0.4);
        const normalizedHeight = Math.max(0.12, Math.min(0.88, waveVal * 0.85 + 0.1));
        const barH = h * normalizedHeight;
        const y = (h - barH) / 2;

        // Gradient from Acid Yellow to Cyan
        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, '#D2E823');
        grad.addColorStop(1, isDark ? '#0284C7' : '#09090B');

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barH);
      }

      visualizerAnimId = requestAnimationFrame(renderFrame);
    }

    renderFrame();
  }

  function stopWaveformAnimation() {
    if (visualizerAnimId) {
      cancelAnimationFrame(visualizerAnimId);
      visualizerAnimId = null;
    }
    drawIdleWaveform();
  }

  // -------------------------------------------------------------------------
  // Session Takes History Rendering
  // -------------------------------------------------------------------------
  function renderSessionTakes() {
    const container = document.getElementById('director-session-takes');
    if (!container) return;

    if (state.sessionTakes.length === 0) {
      container.innerHTML = `
        <div class="director-empty-takes">
          <i class="fa-solid fa-compact-disc text-muted" style="font-size: 1.75rem; margin-bottom: 0.5rem; display: block;"></i>
          No directed takes generated yet. Select your voice &amp; emotion and click Generate Speech.
        </div>`;
      return;
    }

    container.innerHTML = state.sessionTakes.map((take) => `
      <div class="director-take-item" data-id="${take.id}">
        <div class="director-take-left">
          <button type="button" class="director-take-play-btn" data-play-id="${take.id}" title="Play take">
            <i class="fa-solid fa-play"></i>
          </button>
          <div class="director-take-meta">
            <div class="director-take-title" title="${take.text}">${take.text}</div>
            <div class="director-take-badges">
              <span class="director-pill-tag">${take.voiceName}</span>
              <span class="director-pill-tag">${take.emotion}</span>
              <span class="director-pill-tag">${take.style}</span>
              <span class="director-pill-tag">${take.speed}×</span>
              <span class="director-pill-tag"><i class="fa-regular fa-clock"></i> ${take.duration}</span>
            </div>
          </div>
        </div>
        <div class="director-take-actions">
          <button type="button" class="director-take-download-btn" data-download-take-id="${take.id}" data-format="wav" title="Download 24kHz Neural WAV">
            <i class="fa-solid fa-download"></i>
          </button>
          <button type="button" class="director-take-download-btn" data-download-take-id="${take.id}" data-format="mp3" title="Download 192kbps MP3">
            <i class="fa-solid fa-file-audio"></i>
          </button>
        </div>
      </div>
    `).join('');

    // Attach play handlers for take items
    container.querySelectorAll('[data-play-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-play-id');
        const take = state.sessionTakes.find((t) => t.id === id);
        if (take && take.audioUrl) {
          loadAudioTake(take.audioUrl, take.audioBlob, take.rawDuration, take.id);
          notify(`Playing take: ${take.voiceName} (${take.emotion})`, 'info');
        }
      });
    });

    // Attach download handlers for take items
    container.querySelectorAll('[data-download-take-id]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-download-take-id');
        const format = btn.getAttribute('data-format') || 'wav';
        const take = state.sessionTakes.find((t) => t.id === id);
        if (!take) return;

        const vName = (take.voiceName || 'voice').replace(/[^a-zA-Z0-9_-]/g, '_');
        const emo = (take.emotion || 'take').toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_');

        if (format === 'wav') {
          if (take.audioUrl) {
            triggerFileDownload(take.audioUrl, `valora-director-${emo}-${vName}.wav`);
            notify('24kHz Neural WAV file downloaded.', 'success');
          }
          return;
        }

        // Format is MP3
        if (take.mp3Url) {
          triggerFileDownload(take.mp3Url, `valora-director-${emo}-${vName}.mp3`);
          notify('192kbps MP3 audio file downloaded.', 'success');
          return;
        }

        if (take.isConvertingMp3) return;

        take.isConvertingMp3 = true;
        const origIcon = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;

        try {
          const resp = await fetch('/api/tts/convert-mp3', {
            method: 'POST',
            headers: { 'Content-Type': 'audio/wav' },
            body: take.audioBlob,
          });

          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

          const blob = await resp.blob();
          const typedBlob = new Blob([blob], { type: 'audio/mpeg' });
          const mp3Url = URL.createObjectURL(typedBlob);

          take.mp3Blob = typedBlob;
          take.mp3Url = mp3Url;

          if (state.currentTakeId === take.id) {
            state.currentMp3Blob = typedBlob;
            state.currentMp3Url = mp3Url;
          }

          triggerFileDownload(mp3Url, `valora-director-${emo}-${vName}.mp3`);
          notify('192kbps MP3 downloaded successfully.', 'success');
        } catch (err) {
          console.error('Take MP3 conversion error:', err);
          notify('Failed to convert take to MP3. Please try again.', 'error');
        } finally {
          take.isConvertingMp3 = false;
          btn.innerHTML = origIcon;
          btn.disabled = false;
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Synthesis Request (Preview vs Full Generation)
  // -------------------------------------------------------------------------
  async function generateDirectedSpeech(isFullScript = true) {
    const textInput = document.getElementById('director-script-input');
    const fullText = textInput ? textInput.value.trim() : '';

    if (!fullText) {
      if (textInput) {
        textInput.classList.add('has-error');
        setTimeout(() => textInput.classList.remove('has-error'), 1600);
      }
      notify('Please enter or insert a script before generating speech.', 'error');
      return;
    }

    // If preview, use the first sentence or first 120 characters
    let synthesisText = fullText;
    if (!isFullScript) {
      const match = fullText.match(/^[^.!?]+[.!?]/);
      synthesisText = match ? match[0] : fullText.slice(0, 120);
      if (synthesisText.length < fullText.length) synthesisText += '...';
    }

    const generateBtn = document.getElementById('btn-director-generate');
    const previewBtn = document.getElementById('btn-director-preview');
    const progressBox = document.getElementById('director-progress-box');
    const progressFill = document.getElementById('director-progress-fill');
    const progressPct = document.getElementById('director-progress-pct');
    const progressLabel = document.getElementById('director-progress-label');

    // UI Loading State
    state.isGenerating = true;
    if (isFullScript && generateBtn) {
      generateBtn.disabled = true;
      generateBtn.classList.add('is-loading');
      generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Directing Voice...</span>';
    } else if (!isFullScript && previewBtn) {
      previewBtn.disabled = true;
      previewBtn.classList.add('is-loading');
      previewBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Previewing...</span>';
    }

    if (progressBox) {
      progressBox.style.display = 'block';
      if (progressFill) progressFill.style.width = '25%';
      if (progressPct) progressPct.textContent = '25%';
      if (progressLabel) progressLabel.textContent = isFullScript ? 'Synthesizing directed full performance...' : 'Generating audio preview sample...';
    }

    // Build Payload
    const payload = {
      text: synthesisText,
      voice_preset: state.activeVoiceId,
      emotion: state.activeEmotion,
      emotion_intensity: state.activeEmotion === 'neutral' ? 0 : state.intensity,
      speed: state.speed,
      delivery_style: state.activeStyle
    };

    try {
      if (progressFill) progressFill.style.width = '65%';
      if (progressPct) progressPct.textContent = '65%';

      // Attempt /api/tts/generate, fall back to /tts/generate
      let apiRes = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'audio/wav, application/json'
        },
        body: JSON.stringify(payload)
      }).catch(() => null);

      if (!apiRes || !apiRes.ok) {
        apiRes = await fetch('/tts/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'audio/wav, application/json'
          },
          body: JSON.stringify(payload)
        }).catch(() => null);
      }

      if (progressFill) progressFill.style.width = '100%';
      if (progressPct) progressPct.textContent = '100%';

      if (progressBox) {
        setTimeout(() => {
          progressBox.style.display = 'none';
        }, 400);
      }

      // Check Server Response
      if (!apiRes || !apiRes.ok) {
        handleSynthesisFailure(apiRes);
        return;
      }

      // Successful audio generation
      const audioBlob = await apiRes.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      const durationHeader = parseFloat(apiRes.headers.get('X-Audio-Duration-Seconds'));
      let rawDuration = (durationHeader && !isNaN(durationHeader)) ? durationHeader : 0;

      // Update state
      state.isBackendConnected = true;
      state.lastGeneratedSettings = {
        voiceId: state.activeVoiceId,
        emotion: state.activeEmotion,
        style: state.activeStyle,
        intensity: state.intensity,
        speed: state.speed,
        text: fullText,
        isFullScript: isFullScript
      };

      const takeId = 'take-' + Date.now();

      // Load into audio master player
      loadAudioTake(audioUrl, audioBlob, rawDuration, takeId);

      // Save Take to session history
      const voices = getVoiceCatalog();
      const currentVoice = voices.find((v) => v.id === state.activeVoiceId) || voices[0];
      const emoTitle = state.activeEmotion.charAt(0).toUpperCase() + state.activeEmotion.slice(1);
      const styleTitle = state.activeStyle.charAt(0).toUpperCase() + state.activeStyle.slice(1);

      state.sessionTakes.unshift({
        id: takeId,
        voiceName: currentVoice ? currentVoice.name : state.activeVoiceId,
        emotion: emoTitle,
        style: styleTitle,
        intensity: state.intensity,
        speed: state.speed,
        text: synthesisText.slice(0, 60) + (synthesisText.length > 60 ? '...' : ''),
        fullText: synthesisText,
        duration: formatSeconds(rawDuration || 5),
        rawDuration: rawDuration,
        audioUrl: audioUrl,
        audioBlob: audioBlob,
        mp3Url: null,
        mp3Blob: null,
        isConvertingMp3: false,
        timestamp: new Date().toLocaleTimeString()
      });

      renderSessionTakes();

      if (isFullScript) {
        notify(`Directing complete! Synthesized ${formatSeconds(rawDuration)} of speech.`, 'success');
      } else {
        notify('Preview sample generated successfully.', 'info');
      }

    } catch (err) {
      console.error('Synthesis error:', err);
      handleSynthesisFailure(null);
    } finally {
      state.isGenerating = false;
      if (generateBtn) {
        generateBtn.disabled = fullText.length === 0;
        generateBtn.classList.remove('is-loading');
        generateBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>Generate Speech</span>';
      }
      if (previewBtn) {
        previewBtn.disabled = fullText.length === 0;
        previewBtn.classList.remove('is-loading');
        previewBtn.innerHTML = '<i class="fa-solid fa-play"></i> <span>Preview Voice</span>';
      }
    }
  }

  // Handle server communication failure or offline state
  function handleSynthesisFailure(apiRes) {
    state.isBackendConnected = false;

    const setupCard = document.getElementById('director-setup-card');
    if (setupCard) setupCard.style.display = 'block';

    const statusText = document.getElementById('director-status-text');
    const statusPill = document.getElementById('director-status-pill');
    if (statusText) statusText.textContent = 'Service Offline';
    if (statusPill) statusPill.classList.add('offline');

    let errorMsg = 'Backend speech service offline. Please start server via "python run.py --server".';
    if (apiRes) {
      errorMsg = `Server error (${apiRes.status}): ${apiRes.statusText || 'Unable to generate speech.'}`;
    }

    notify(errorMsg, 'error');
  }

  // -------------------------------------------------------------------------
  // Verify Backend Connection Health
  // -------------------------------------------------------------------------
  async function checkBackendConnection() {
    try {
      const res = await fetch('/health', { method: 'GET' }).catch(() => null);
      const setupCard = document.getElementById('director-setup-card');
      const statusText = document.getElementById('director-status-text');
      const statusPill = document.getElementById('director-status-pill');

      if (res && res.ok) {
        state.isBackendConnected = true;
        if (setupCard) setupCard.style.display = 'none';
        if (statusText) statusText.textContent = 'Engine Ready';
        if (statusPill) statusPill.classList.remove('offline');
        return true;
      } else {
        state.isBackendConnected = false;
        if (statusText) statusText.textContent = 'Service Offline';
        if (statusPill) statusPill.classList.add('offline');
        return false;
      }
    } catch (_) {
      state.isBackendConnected = false;
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Module Initialization
  // -------------------------------------------------------------------------
  function init() {
    const textInput = document.getElementById('director-script-input');
    const charCount = document.getElementById('director-char-count');
    const generateBtn = document.getElementById('btn-director-generate');
    const previewBtn = document.getElementById('btn-director-preview');
    const resetBtn = document.getElementById('btn-director-reset');
    const voiceSelect = document.getElementById('director-voice-select');
    const browseVoicesBtn = document.getElementById('btn-director-browse-voices');
    const retryConnBtn = document.getElementById('btn-director-retry-conn');
    const clearHistoryBtn = document.getElementById('btn-director-clear-history');

    // Populate voices
    populateVoiceSelector();

    // Voice Selector Change Handler
    if (voiceSelect) {
      voiceSelect.addEventListener('change', () => {
        state.activeVoiceId = voiceSelect.value;
        updateActiveVoicePreview();
        checkSettingsChanged();
      });
    }

    // Browse Library Button
    if (browseVoicesBtn) {
      browseVoicesBtn.addEventListener('click', () => {
        if (window.ValoraApp && typeof window.ValoraApp.navigateTo === 'function') {
          window.ValoraApp.navigateTo('voices');
        } else {
          window.location.hash = '#voices';
        }
      });
    }

    // Character Counter & Button Enable/Disable
    if (textInput) {
      textInput.addEventListener('input', () => {
        const len = textInput.value.length;
        if (charCount) {
          charCount.textContent = `${len.toLocaleString()} / 5,000 characters`;
          charCount.classList.toggle('limit-reached', len >= 5000);
        }

        const hasText = textInput.value.trim().length > 0;
        if (generateBtn) generateBtn.disabled = !hasText;
        if (previewBtn) previewBtn.disabled = !hasText;

        checkSettingsChanged();
      });
    }

    // Quick Sample Script Handlers
    document.querySelectorAll('.director-sample-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const sampleKey = chip.getAttribute('data-sample') || 'primary';
        const sampleText = SAMPLE_SCRIPTS[sampleKey] || SAMPLE_SCRIPTS.primary;

        if (textInput) {
          textInput.value = sampleText;
          textInput.dispatchEvent(new Event('input'));
        }
        notify(`Sample "${chip.textContent.trim()}" loaded`, 'info');
      });
    });

    // Emotion Selection Buttons
    document.querySelectorAll('#director-emotion-container .emotion-card-btn').forEach((btn) => {
      const selectEmotion = () => {
        document.querySelectorAll('#director-emotion-container .emotion-card-btn').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-checked', 'false');
        });

        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        const emotion = btn.getAttribute('data-emotion') || 'neutral';
        state.activeEmotion = emotion;

        // Intensity slider behavior: disabled for Neutral, enabled otherwise
        const intensitySlider = document.getElementById('director-intensity-slider');
        const intensityBox = document.getElementById('director-intensity-box');
        const intensityMsg = document.getElementById('director-intensity-disabled-msg');

        if (emotion === 'neutral') {
          if (intensitySlider) intensitySlider.disabled = true;
          if (intensityBox) intensityBox.classList.add('disabled');
          if (intensityMsg) intensityMsg.style.display = 'block';
        } else {
          if (intensitySlider) intensitySlider.disabled = false;
          if (intensityBox) intensityBox.classList.remove('disabled');
          if (intensityMsg) intensityMsg.style.display = 'none';
        }

        updateCombinationBanner();
        checkSettingsChanged();
      };

      btn.addEventListener('click', selectEmotion);
      btn.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          selectEmotion();
        }
      });
    });

    // Delivery Style Selection Buttons
    document.querySelectorAll('#director-delivery-container .delivery-card-btn').forEach((btn) => {
      const selectStyle = () => {
        document.querySelectorAll('#director-delivery-container .delivery-card-btn').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-checked', 'false');
        });

        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        const style = btn.getAttribute('data-style') || 'natural';
        state.activeStyle = style;

        updateCombinationBanner();
        checkSettingsChanged();
      };

      btn.addEventListener('click', selectStyle);
      btn.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          selectStyle();
        }
      });
    });

    // Intensity Slider
    const intensitySlider = document.getElementById('director-intensity-slider');
    const intensityVal = document.getElementById('director-intensity-val');
    if (intensitySlider) {
      intensitySlider.addEventListener('input', () => {
        state.intensity = parseInt(intensitySlider.value, 10);
        if (intensityVal) intensityVal.textContent = `${state.intensity}%`;
        checkSettingsChanged();
      });
    }

    // Speaking Speed Slider
    const speedSlider = document.getElementById('director-speed-slider');
    const speedVal = document.getElementById('director-speed-val');
    if (speedSlider) {
      speedSlider.addEventListener('input', () => {
        state.speed = parseFloat(speedSlider.value);
        if (speedVal) speedVal.textContent = `${state.speed.toFixed(2)}×`;
        checkSettingsChanged();
      });
    }

    // Action Buttons
    if (previewBtn) {
      previewBtn.addEventListener('click', () => generateDirectedSpeech(false));
    }
    if (generateBtn) {
      generateBtn.addEventListener('click', () => generateDirectedSpeech(true));
    }

    // Reset Settings Button
    if (resetBtn) {
      resetBtn.addEventListener('click', resetSettings);
    }

    // Retry Backend Connection Button
    if (retryConnBtn) {
      retryConnBtn.addEventListener('click', async () => {
        notify('Checking backend speech service connection...', 'info');
        const ok = await checkBackendConnection();
        if (ok) {
          notify('Backend speech service is connected and healthy!', 'success');
        } else {
          notify('Backend service is still unreachable on port 8000.', 'error');
        }
      });
    }

    // Clear Takes History
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', () => {
        state.sessionTakes = [];
        renderSessionTakes();
        notify('Director session history cleared.', 'info');
      });
    }

    // Initialize Audio Player
    initAudioPlayer();

    // Initial check of backend connection
    checkBackendConnection();
  }

  // -------------------------------------------------------------------------
  // Render View (Triggered on Navigation)
  // -------------------------------------------------------------------------
  function render() {
    populateVoiceSelector();
    updateActiveVoicePreview();
    updateCombinationBanner();
    checkSettingsChanged();
    drawIdleWaveform();
    checkBackendConnection();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  window.ValoraDirector = {
    init: init,
    render: render,
    updateVoices: populateVoiceSelector,
    resetSettings: resetSettings,
    getState: () => state
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
