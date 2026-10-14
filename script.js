let cameraInstance = null;
let poseInstance = null;

let currentThreshold = 0.10;
let showConnectorsFlag = true;
let showLandmarksFlag = true;

function switchView(viewId) {
    // Kamera sofort stoppen und komplett zerstören beim Verlassen
    stopCamera();

    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');
}

function stopCameraAndSwitch(viewId) {
    switchView(viewId);
}

function stopCamera() {
    if (cameraInstance) {
        cameraInstance.stop();
        cameraInstance = null;
    }
    poseInstance = null;
}

function updateThreshold(val) {
    currentThreshold = parseFloat(val);
    document.getElementById('threshold-val').innerText = currentThreshold.toFixed(2);
}

// Wird NUR durch den Klick auf den Button in der Kalibrierung aufgerufen
function startCalibrationCamera() {
    if (cameraInstance) return; // Läuft schon
    initCameraFeed('webcam-calib', 'output_canvas-calib');
}

function initCameraFeed(videoElementId, canvasElementId) {
    const videoElement = document.getElementById(videoElementId);
    const canvasElement = document.getElementById(canvasElementId);
    const canvasCtx = canvasElement.getContext('2d');
    const statusBox = document.getElementById('status-box'); 

    const connectorsCheckbox = document.getElementById('showConnectors');
    const landmarksCheckbox = document.getElementById('showLandmarks');

    poseInstance = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    poseInstance.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: true,
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

                if (statusBox) {
                    if (activePoint) {
                        if (activePoint.x > midSchulterX + currentThreshold) {
                            statusBox.innerText = "rechts ➡️";
                        } else if (activePoint.x < midSchulterX - currentThreshold) {
                            statusBox.innerText = "links ⬅️";
                        } else {
                            statusBox.innerText = "Mitte ⏺️";
                        }
                    } else {
                        statusBox.innerText = "Kein Kopf im Bild! ❌";
                    }
                }
            }
        }
        canvasCtx.restore();
    });

    // Die MediaPipe Camera Hilfsfunktion erst hier instanziieren
    cameraInstance = new Camera(videoElement, {
        onFrame: async () => {
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
            if (poseInstance) {
                await poseInstance.send({image: videoElement});
            }
        },
        width: 640,
        height: 480
    });
    
    cameraInstance.start();
}