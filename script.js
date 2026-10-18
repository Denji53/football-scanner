let videoStream = null;
let poseInstance = null;
let isRunning = false;

let currentThreshold = 0.10;
let showConnectorsFlag = true;
let showLandmarksFlag = true;

// --- AUDIO SYNTHESIZER (Web Audio API) ---
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playSound(type) {
    initAudio();
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'beep') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now); // A5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    } else if (type === 'trigger') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, now); // A4
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
    } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
    }
}

// --- STATE MACHINE MODUS 1 (Mit Ball - Rücken zum Gerät) ---
let m1State = "WAIT_FOR_NO_FACE"; // States: WAIT_FOR_NO_FACE, READY, SCANNING, SUCCESS
let m1StartTime = 0;
let m1Timer = null;

// --- STATE MACHINE MODUS 2 (Kognitiv - Audio Trigger) ---
let m2State = "IDLE"; // States: IDLE, WAITING_SIGNAL, SIGNAL_ACTIVE, SCAN_DETECTED, SUCCESS
let m2Timer = null;
let m2SignalTime = 0;
let m2TaskText = "";

function switchView(viewId) {
    initAudio();
    stopCamera();

    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');

    if (viewId === 'calibration') {
        initCameraFeed('webcam-calib', 'output_canvas-calib');
    } else if (viewId === 'mod-ball') {
        initCameraFeed('webcam', 'output_canvas');
        resetModus1();
    } else if (viewId === 'mod-noball') {
        initCameraFeed('webcam-noball', 'output_canvas-noball');
        resetModus2();
    } else if (viewId === 'stats') {
        loadAndDisplayStats();
    }
}

function stopCameraAndSwitch(viewId) {
    stopCamera();
    switchView(viewId);
}

function stopCamera() {
    isRunning = false;
    if (m1Timer) clearTimeout(m1Timer);
    if (m2Timer) clearTimeout(m2Timer);
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    poseInstance = null;
}

function updateThreshold(val) {
    currentThreshold = parseFloat(val);
    const label = document.getElementById('threshold-val');
    if (label) label.innerText = currentThreshold.toFixed(2);
}

async function initCameraFeed(videoElementId, canvasElementId) {
    const videoElement = document.getElementById(videoElementId);
    const canvasElement = document.getElementById(canvasElementId);
    const canvasCtx = canvasElement.getContext('2d');
    
    let statusBox = null;
    if (videoElementId === 'webcam-calib') statusBox = document.getElementById('status-box-calib');
    else if (videoElementId === 'webcam') statusBox = document.getElementById('status-box');
    else if (videoElementId === 'webcam-noball') statusBox = document.getElementById('cognitive-display');

    const connectorsCheckbox = document.getElementById('showConnectors');
    const landmarksCheckbox = document.getElementById('showLandmarks');

    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 }
        });
        
        videoElement.srcObject = videoStream;
        await videoElement.play();

        poseInstance = new Pose({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });

        poseInstance.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        poseInstance.onResults((results) => {
            if (connectorsCheckbox) showConnectorsFlag = connectorsCheckbox.checked;
            if (landmarksCheckbox) showLandmarksFlag = landmarksCheckbox.checked;

            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

            const hasPose = results.poseLandmarks && results.poseLandmarks.length > 0;
            const nose = hasPose ? results.poseLandmarks[0] : null;
            // Wenn die Nase mit hoher/ausreichender Zuverlässigkeit erfasst wird = Gesicht sichtbar
            const isFaceVisible = nose && nose.visibility > 0.6;

            if (hasPose) {
                if (showConnectorsFlag) {
                    drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
                }
                if (showLandmarksFlag) {
                    drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2});
                }
            }

            if (videoElementId === 'webcam-calib') {
                if (hasPose && results.poseLandmarks[11] && results.poseLandmarks[12]) {
                    const midSchulterX = (results.poseLandmarks[11].x + results.poseLandmarks[12].x) * 0.5;
                    drawThresholdVisuals(canvasCtx, canvasElement, midSchulterX, currentThreshold);
                }
                statusBox.innerText = isFaceVisible ? "✅ Gesicht erkannt (Schulterblick)" : "👤 Kein Gesicht (Rücken zum Gerät)";
            } else if (videoElementId === 'webcam') {
                runModus1StateMachine(isFaceVisible, statusBox);
            } else if (videoElementId === 'webcam-noball') {
                runModus2StateMachine(isFaceVisible, statusBox);
            }

            canvasCtx.restore();
        });

        isRunning = true;
        sendFramesToPose(videoElement, canvasElement);

    } catch (err) {
        console.error("Kamera-Fehler:", err);
        alert("Kamerazugriff fehlgeschlagen oder verweigert.");
    }
}

async function sendFramesToPose(videoElement, canvasElement) {
    if (!isRunning || !videoStream) return;
    
    if (videoElement.readyState >= 2 && poseInstance) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        await poseInstance.send({ image: videoElement });
    }
    
    requestAnimationFrame(() => sendFramesToPose(videoElement, canvasElement));
}

function drawThresholdVisuals(ctx, canvas, midSchulterX, threshold) {
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const centerXPixel = midSchulterX * canvasW;
    const thresholdPixelOffset = threshold * canvasW;

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00ffff';
    ctx.beginPath(); ctx.moveTo(centerXPixel, 0); ctx.lineTo(centerXPixel, canvasH); ctx.stroke();

    ctx.strokeStyle = '#ff3333';
    ctx.beginPath(); ctx.moveTo(centerXPixel - thresholdPixelOffset, 0); ctx.lineTo(centerXPixel - thresholdPixelOffset, canvasH); ctx.stroke();

    ctx.strokeStyle = '#3333ff';
    ctx.beginPath(); ctx.moveTo(centerXPixel + thresholdPixelOffset, 0); ctx.lineTo(centerXPixel + thresholdPixelOffset, canvasH); ctx.stroke();
}

// --- LOGIK MODUS 1 (Mit Ball) ---
function resetModus1() {
    m1State = "WAIT_FOR_NO_FACE";
    if (m1Timer) clearTimeout(m1Timer);
}

function runModus1StateMachine(isFaceVisible, statusBox) {
    switch (m1State) {
        case "WAIT_FOR_NO_FACE":
            statusBox.style.backgroundColor = "rgba(0,0,0,0.7)";
            if (!isFaceVisible) {
                statusBox.innerText = " Bereit! Spiele den Ball & mache den Scan...";
                m1State = "READY";
            } else {
                statusBox.innerText = " Drehe dich mit dem Rücken zum Gerät!";
            }
            break;

        case "READY":
            if (isFaceVisible) {
                // Schulterblick erkannt! (Gesicht taucht auf)
                m1StartTime = performance.now();
                m1State = "SCANNING";
                playSound('beep');
                statusBox.style.backgroundColor = "#ff9800";
                statusBox.innerText = " SCAN ERKANNT!";
            }
            break;

        case "SCANNING":
            if (!isFaceVisible) {
                // Kopf hat sich wieder weggedreht = Scan abgeschlossen!
                const scanDuration = ((performance.now() - m1StartTime) / 1000).toFixed(2);
                m1State = "SUCCESS";
                playSound('success');
                statusBox.style.backgroundColor = "#4caf50";
                statusBox.innerText = ` Top Scan! Dauer: ${scanDuration}s`;

                saveScoreToLocalStorage(scanDuration, "Modus 1 (Ball)");

                m1Timer = setTimeout(() => {
                    resetModus1();
                }, 2000);
            }
            break;

        case "SUCCESS":
            break;
    }
}

// --- LOGIK MODUS 2 (Kognitiv) ---
function resetModus2() {
    m2State = "IDLE";
    if (m2Timer) clearTimeout(m2Timer);
    m2Timer = setTimeout(() => {
        startModus2Sequence();
    }, 1500);
}

function startModus2Sequence() {
    m2State = "WAITING_SIGNAL";
}

function runModus2StateMachine(isFaceVisible, statusBox) {
    switch (m2State) {
        case "IDLE":
            statusBox.style.backgroundColor = "rgba(0,0,0,0.7)";
            statusBox.innerText = "Bereit machen...";
            break;

        case "WAITING_SIGNAL":
            if (!isFaceVisible) {
                statusBox.style.backgroundColor = "rgba(0,0,0,0.7)";
                statusBox.innerText = " Warten auf Audiosignal...";

                // Nach zufälliger Zeit (2–4 Sekunden) Signal auslösen
                if (!m2Timer) {
                    const randomDelay = Math.floor(Math.random() * 2000) + 2000;
                    m2Timer = setTimeout(() => {
                        triggerCognitiveSignal();
                    }, randomDelay);
                }
            } else {
                statusBox.innerText = " Drehe dich mit dem Rücken zum Gerät!";
            }
            break;

        case "SIGNAL_ACTIVE":
            // Signal wurde abgespielt – warten auf den Schulterblick (Gesicht)
            statusBox.style.backgroundColor = "#e91e63";
            statusBox.innerText = ` SCHULTERBLICK JETZT! [ ${m2TaskText} ]`;

            if (isFaceVisible) {
                const reactionTime = ((performance.now() - m2SignalTime) / 1000).toFixed(2);
                m2State = "SCAN_DETECTED";
                playSound('success');
                statusBox.style.backgroundColor = "#4caf50";
                statusBox.innerText = ` Erfasst! ${reactionTime}s (${m2TaskText})`;

                saveScoreToLocalStorage(reactionTime, `Kognitiv: ${m2TaskText}`);

                m2Timer = setTimeout(() => {
                    m2Timer = null;
                    resetModus2();
                }, 3000);
            }
            break;

        case "SCAN_DETECTED":
            break;
    }
}

function triggerCognitiveSignal() {
    m2Timer = null;
    playSound('trigger');

    const colors = ["ROT", "BLAU", "GELB", "GRÜN"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const randomNum = Math.floor(Math.random() * 9) + 1;
    m2TaskText = `${randomColor} ${randomNum}`;

    m2SignalTime = performance.now();
    m2State = "SIGNAL_ACTIVE";
}

// --- LOCALSTORAGE STATISTIKEN ---
function saveScoreToLocalStorage(time, modeInfo) {
    let history = JSON.parse(localStorage.getItem('scan_history')) || [];
    history.unshift({ date: new Date().toLocaleTimeString(), time: parseFloat(time), direction: modeInfo });
    if (history.length > 20) history.pop();
    localStorage.setItem('scan_history', JSON.stringify(history));
}

function loadAndDisplayStats() {
    const statsContainer = document.getElementById('stats');
    let history = JSON.parse(localStorage.getItem('scan_history')) || [];
    let html = `<button class="back-btn" onclick="switchView('main-menu')">⬅️ Menü</button><h2>Statistiken</h2>`;

    if (history.length === 0) {
        html += `<p>Noch keine Trainingsdaten vorhanden.</p>`;
    } else {
        html += `<ul style="list-style: none; padding: 0; width: 80%; max-width: 300px;">`;
        history.forEach((item, index) => {
            html += `<li style="background: #1e1e1e; margin-bottom: 8px; padding: 10px; border-radius: 6px;">
                #${index + 1} - <strong>${item.time}s</strong> (${item.direction}) <span style="font-size: 11px; color: #888; float: right;">${item.date}</span>
            </li>`;
        });
        html += `</ul>`;
        html += `<button onclick="clearStats()" style="background-color: #d9534f; margin-top: 15px;">Statistik zurücksetzen</button>`;
    }
    statsContainer.innerHTML = html;
}

function clearStats() {
    localStorage.removeItem('scan_history');
    loadAndDisplayStats();
}
