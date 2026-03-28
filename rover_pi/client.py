import cv2
import socketio
import time
import random
import sys

# Configuration
SERVER_URL = "http://localhost:8000" # Change this to the Windows laptop's IP address (e.g. http://192.168.1.100:8000)
DEVICE_ID = "Rover-01"
FPS_LIMIT = 15 # Limit FPS to save bandwidth

sio = socketio.Client()

@sio.event
def connect():
    print(f"[{DEVICE_ID}] Connected to server at {SERVER_URL}")
    # Register device upon connection
    sio.emit("register", {
        "device_id": DEVICE_ID,
        "status": "active"
    })

@sio.event
def disconnect():
    print(f"[{DEVICE_ID}] Disconnected from server")

def get_simulated_cpu_temp():
    # In a real Pi, you'd read /sys/class/thermal/thermal_zone0/temp
    # Returning a simulated temp for demonstration
    return round(random.uniform(40.0, 55.0), 1)

def main():
    try:
        sio.connect(SERVER_URL)
    except Exception as e:
        print(f"Failed to connect to {SERVER_URL}: {e}")
        sys.exit(1)

    # Initialize Camera
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Error: Could not open camera.")
        sio.disconnect()
        sys.exit(1)

    # Reduce resolution for networking performance
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    print(f"[{DEVICE_ID}] Starting video stream...")

    last_frame_time = time.time()
    last_telemetry_time = time.time()
    frame_count = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Failed to grab frame")
                time.sleep(1)
                continue

            current_time = time.time()
            
            # FPS Limiting
            if current_time - last_frame_time >= 1.0 / FPS_LIMIT:
                last_frame_time = current_time

                # 1. Process Standard RGB Frame
                # Compress to JPEG
                encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 70]
                _, rgb_encoded = cv2.imencode('.jpg', frame, encode_param)
                rgb_bytes = rgb_encoded.tobytes()

                # Emit Standard Video Frame (Binary)
                # python-socketio handles dicts with bytes by sending binary attachments
                sio.emit('video_frame', {
                    'device_id': DEVICE_ID,
                    'type': 'standard',
                    'data': rgb_bytes
                })

                # 2. Process Fake Thermal Frame
                # Convert to grayscale first, then apply semantic thermal colormap
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                thermal = cv2.applyColorMap(gray, cv2.COLORMAP_INFERNO)
                
                _, thermal_encoded = cv2.imencode('.jpg', thermal, encode_param)
                thermal_bytes = thermal_encoded.tobytes()

                # Emit Thermal Video Frame (Binary)
                sio.emit('video_frame', {
                    'device_id': DEVICE_ID,
                    'type': 'thermal',
                    'data': thermal_bytes
                })

                frame_count += 1
                if frame_count % 30 == 0:
                    print(f"Successfully captured and sent {frame_count} frames...")

            # Send Telemetry Data every 2 seconds
            if current_time - last_telemetry_time >= 2.0:
                last_telemetry_time = current_time
                sio.emit('telemetry', {
                    'device_id': DEVICE_ID,
                    'cpu_temp': get_simulated_cpu_temp(),
                    'status': 'active'
                })

            # Sleep briefly to yield CPU
            time.sleep(0.01)

    except KeyboardInterrupt:
        print("Stopping stream...")
    finally:
        cap.release()
        sio.disconnect()

if __name__ == '__main__':
    main()
