let cameraInstance = null;
let poseInstance = null;

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');

    // Wenn in Kalibrierung oder Modus 1 gewechselt wird, können wir hier die Kamera steuern
    if (viewId === 'calibration') {
        initCameraFeed('webcam-calib', 'output_canvas-calib');
    } else if (viewId === 'mod-ball') {
        initCameraFeed('webcam', 'output_canvas');
    }
}

function stopCameraAndSwitch(viewId) {
    if (cameraInstance) {
        cameraInstance.stop();
        cameraInstance = null;
    }
    switchView(viewId);
}

function initCameraFeed(videoElementId, canvasElementId) {
    const videoElement = document.getElementById(videoElementId);
    const canvasElement = document.getElementById(canvasElementId);
    const canvasCtx = canvasElement.getContext('2d');
    const statusBox = document.getElementById('status-box');

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
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

        if (results.poseLandmarks) {
            drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
            drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2});

            // Hier kommt später unsere Schulterblick-Logik rein
            const rightShoulder = results.poseLandmarks[12];
            const leftShoulder = results.poseLandmarks[11];
            const nose = results.poseLandmarks[0];
            const rightEar = results.poseLandmarks[8];
            const leftEar = results.poseLandmarks[7];

            if (rightShoulder && leftShoulder) {
                const midSchulterX = (rightShoulder.x + leftShoulder.x) * 0.5;
                const threshold = 0.1;
                const activePoint = nose || rightEar || leftEar;

                if (statusBox) {
                    if (activePoint) {
                        if (activePoint.x > midSchulterX + threshold) {
                            statusBox.innerText = "rechts ➡️";
                        } else if (activePoint.x < midSchulterX - threshold) {
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

    cameraInstance = new Camera(videoElement, {
        onFrame: async () => {
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
            await poseInstance.send({image: videoElement});
        },
        width: 640,
        height: 480
    });
    cameraInstance.start();
}