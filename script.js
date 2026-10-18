let videoStream = null;
let poseInstance = null;
let isRunning = false;

let currentThreshold = 0.10;
let showConnectorsFlag = true;
let showLandmarksFlag = true;

// --- STATE MACHINE VARIABLEN ---
let trainingState = "IDLE"; // Mögliche States: "IDLE", "WAITING", "SCANNING", "SUCCESS"
let targetDirection = null; // "links" oder "rechts"
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
        // Starte das Training direkt, wenn Modus 1 geladen wird
        resetTrainingState();
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
    const statusBox = document.getElementById('status-box');

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

                    // Nur in Modus 1 führen wir die State Machine aus
                    if (videoElementId === 'webcam' && statusBox) {
                        runTrainingStateMachine(activePoint, midSchulterX, statusBox);
                    } else if (statusBox && activePoint) {
                        // Einfache Anzeige für Kalibrierung/Feedback
                        if (activePoint.x > midSchulterX + currentThreshold) {
                            statusBox.innerText = "rechts ➡️";
                        } else if (activePoint.x < midSchulterX - currentThreshold) {
                            statusBox.innerText = "links ⬅️";
                        } else {
                            statusBox.innerText = "Mitte ⏺️";
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
    // Zufällig Ziel bestimmen: "links" oder "rechts"
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
                
                // Sobald er stabil in der Mitte steht, starten wir den echten Scan-Modus nach einer kurzen Sekunde
                trainingState = "SCANNING";
                scanStartTime = performance.now();
                statusBox.style.backgroundColor = "#ff9800"; // Orange für "Achtung"
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

            // Prüfen, ob der Spieler in die *geforderte* Richtung geschaut hat
            if (currentHeadDir === targetDirection) {
                const endTime = performance.now();
                reactionTime = ((endTime - scanStartTime) / 1000).toFixed(2);
                
                trainingState = "SUCCESS";
                statusBox.style.backgroundColor = "#4caf50"; // Grün für Erfolg
                statusBox.innerText = `✅ Top! Zeit: ${reactionTime}s`;

                // Nach 2 Sekunden automatisch nächste Runde starten
                stateTimer = setTimeout(() => {
                    statusBox.style.backgroundColor = "rgba(0,0,0,0.6)";
                    resetTrainingState();
                }, 2000);
            }
            break;

        case "SUCCESS":
            // Warten bis der Timer abgelaufen ist
            break;
    }
}

