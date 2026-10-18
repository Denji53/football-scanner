let videoStream = null;
let poseInstance = null;
let isRunning = false;

let currentThreshold = 0.10;
let showConnectorsFlag = true;
let showLandmarksFlag = true;

// --- STATE MACHINE & STATS ---
let trainingState = "IDLE";
let targetDirection = null;
let stateTimer = null;
let scanStartTime = 0;
let reactionTime = 0;

function switchView(viewId) {
    stopCamera();

    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');

    if (viewId === 'calibration') {
        initCameraFeed('webcam-calib', 'output_canvas-calib');
    } else if (viewId === 'mod-ball') {
        initCameraFeed('webcam', 'output_canvas');
        resetTrainingState();
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
    if (stateTimer) clearTimeout(stateTimer);
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
    
    // Unterscheiden ob Kalibrierungs-Statusbox oder Modus 1 Statusbox
    const statusBox = videoElementId === 'webcam-calib' 
        ? document.getElementById('status-box-calib') 
        : document.getElementById('status-box');

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

            if (results.poseLandmarks) {
                if (showConnectorsFlag) {
                    drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
                }
                if (showLandmarksFlag) {
                    drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2});
                }

                const rightShoulder = results.poseLandmarks[12];
                const leftShoulder = results.poseLandmarks[11];
                const nose = results.poseLandmarks[0];
                const rightEar = results.poseLandmarks[8];
                const leftEar = results.poseLandmarks[7];

                if (rightShoulder && leftShoulder) {
                    const midSchulterX = (rightShoulder.x + leftShoulder.x) * 0.5;
                    const activePoint = nose || rightEar || leftEar;

                    // --- VISUALISIERUNG DER THRESHOLD-ZONEN (Besonders im Kalibrierungs-Modus stark) ---
                    drawThresholdVisuals(canvasCtx, canvasElement, midSchulterX, currentThreshold);

                    // Workflow-Steuerung
                    if (videoElementId === 'webcam' && statusBox) {
                        runTrainingStateMachine(activePoint, midSchulterX, statusBox);
                    } else if (statusBox && activePoint) {
                        // Live Feedback im Kalibrierungs-Screen
                        if (activePoint.x > midSchulterX + currentThreshold) {
                            statusBox.innerText = "➡️ Rechts erkannt (Schwelle überschritten)";
                        } else if (activePoint.x < midSchulterX - currentThreshold) {
                            statusBox.innerText = "⬅️ Links erkannt (Schwelle überschritten)";
                        } else {
                            statusBox.innerText = "⏺️ Mitte (Neutral)";
                        }
                    }
                }
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

// Zeichnet visuelle Linien für den Threshold live ins Canvas
function drawThresholdVisuals(ctx, canvas, midSchulterX, threshold) {
    const canvasW = canvas.width;
    const canvasH = canvas.height;

    const centerXPixel = midSchulterX * canvasW;
    const thresholdPixelOffset = threshold * canvasW;

    ctx.lineWidth = 2;

    // Zentrum (Mitte-Linie)
    ctx.strokeStyle = '#00ffff';
    ctx.beginPath();
    ctx.moveTo(centerXPixel, 0);
    ctx.lineTo(centerXPixel, canvasH);
    ctx.stroke();

    // Linke Toleranzgrenze
    ctx.strokeStyle = '#ff3333';
    ctx.beginPath();
    ctx.moveTo(centerXPixel - thresholdPixelOffset, 0);
    ctx.lineTo(centerXPixel - thresholdPixelOffset, canvasH);
    ctx.stroke();

    // Rechte Toleranzgrenze
    ctx.strokeStyle = '#3333ff';
    ctx.beginPath();
    ctx.moveTo(centerXPixel + thresholdPixelOffset, 0);
    ctx.lineTo(centerXPixel + thresholdPixelOffset, canvasH);
    ctx.stroke();
}

// --- STATE MACHINE LOGIK FÜR MODUS 1 ---
function resetTrainingState() {
    trainingState = "IDLE";
    if (stateTimer) clearTimeout(stateTimer);
    
    stateTimer = setTimeout(() => {
        startWaitingPhase();
    }, 1500);
}

function startWaitingPhase() {
    trainingState = "WAITING";
    targetDirection = Math.random() < 0.5 ? "links" : "rechts";
}

function runTrainingStateMachine(activePoint, midSchulterX, statusBox) {
    if (!activePoint) {
        statusBox.innerText = "Kein Kopf im Bild! ❌";
        return;
    }

    const isCentered = Math.abs(activePoint.x - midSchulterX) <= currentThreshold;

    switch (trainingState) {
        case "IDLE":
            statusBox.innerText = "Bereit machen...";
            break;

        case "WAITING":
            if (isCentered) {
                statusBox.innerText = `⚠️ Scan vorbereiten... (Gleich: ${targetDirection.toUpperCase()})`;
                trainingState = "SCANNING";
                scanStartTime = performance.now();
                statusBox.style.backgroundColor = "#ff9800";
            } else {
                statusBox.innerText = "Bitte in die Mitte ausrichten! ⏺️";
            }
            break;

        case "SCANNING":
            statusBox.innerText = `👉 SCHAU ${targetDirection.toUpperCase()}!`;
            
            let currentHeadDir = null;
            if (activePoint.x > midSchulterX + currentThreshold) {
                currentHeadDir = "rechts";
            } else if (activePoint.x < midSchulterX - currentThreshold) {
                currentHeadDir = "links";
            }

            if (currentHeadDir === targetDirection) {
                const endTime = performance.now();
                reactionTime = ((endTime - scanStartTime) / 1000).toFixed(2);
                
                trainingState = "SUCCESS";
                statusBox.style.backgroundColor = "#4caf50";
                statusBox.innerText = `✅ Top! Zeit: ${reactionTime}s`;

                // Ergebnis im localStorage speichern
                saveScoreToLocalStorage(reactionTime, targetDirection);

                stateTimer = setTimeout(() => {
                    statusBox.style.backgroundColor = "rgba(0,0,0,0.6)";
                    resetTrainingState();
                }, 2000);
            }
            break;

        case "SUCCESS":
            break;
    }
}

// --- LOCALSTORAGE STATISTIKEN ---
function saveScoreToLocalStorage(time, direction) {
    let history = JSON.parse(localStorage.getItem('scan_history')) || [];
    
    const newEntry = {
        date: new Date().toLocaleTimeString(),
        time: parseFloat(time),
        direction: direction
    };

    history.unshift(entry = newEntry); // Neueste Einträge zuerst
    if (history.length > 20) history.pop(); // Max 20 Einträge behalten

    localStorage.setItem('scan_history', JSON.stringify(history));
}

function loadAndDisplayStats() {
    const statsContainer = document.getElementById('stats');
    let history = JSON.parse(localStorage.getItem('scan_history')) || [];

    // HTML-Inhalt für die Statistik-Ansicht dynamisch aufbauen
    let html = `
        <button class="back-btn" onclick="switchView('main-menu')">⬅️ Menü</button>
        <h2>Statistiken</h2>
    `;

    if (history.length === 0) {
        html += `<p>Noch keine Trainingsdaten vorhanden. Absolviere zuerst eine Runde in Modus 1!</p>`;
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
