import json
import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import socketio
import uvicorn
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pmesh_server")

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()

# Make sure static folder exists
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

# State to keep track of active rovers
active_rovers = {}

@app.get("/")
async def get_index():
    return FileResponse("static/index.html")

@sio.event
async def connect(sid, environ):
    logger.info(f"Client connected: {sid}")

@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")
    # Remove from active_rovers if it was a rover
    to_remove = None
    for device_id, data in active_rovers.items():
        if data.get('sid') == sid:
            to_remove = device_id
            break
            
    if to_remove:
        logger.info(f"Rover disconnected: {to_remove}")
        del active_rovers[to_remove]
        # Notify dashboards of updated list
        await sio.emit('device_list_update', list(active_rovers.values()), room='dashboard')

@sio.event
async def register(sid, data):
    # Rover registers itself
    device_id = data.get('device_id')
    status = data.get('status', 'active')
    
    if device_id:
        active_rovers[device_id] = {
            'device_id': device_id,
            'status': status,
            'sid': sid,
            'cpu_temp': None
        }
        logger.info(f"Rover registered: {device_id}")
        await sio.emit('device_list_update', list(active_rovers.values()), room='dashboard')

@sio.event
async def telemetry(sid, data):
    # Rover sends telemetry
    device_id = data.get('device_id')
    if device_id and device_id in active_rovers:
        active_rovers[device_id]['cpu_temp'] = data.get('cpu_temp')
        active_rovers[device_id]['status'] = data.get('status', 'active')
        await sio.emit('telemetry_update', active_rovers[device_id], room='dashboard')

@sio.event
async def video_frame(sid, data):
    # Route binary video frame to dashboard clients subscribed to this device
    device_id = data.get('device_id')
    frame_type = data.get('type')
    binary_data = data.get('data') # This is the raw byte array
    
    # Print statement for debugging incoming frames
    print(f"Received video frame from {sid}, size: {len(binary_data) if binary_data else 0} bytes")
    
    if device_id and binary_data:
        room_name = f"video_{device_id}"
        await sio.emit('video_stream', {
            'device_id': device_id,
            'type': frame_type,
            'data': binary_data
        }, room=room_name)

# Dashboard commands
@sio.event
async def join_dashboard(sid):
    # Dashboard client connects
    await sio.enter_room(sid, 'dashboard')
    await sio.emit('device_list_update', list(active_rovers.values()), to=sid)
    logger.info(f"Dashboard client joined: {sid}")

@sio.event
async def subscribe_video(sid, data):
    # Dashboard requests to watch a specific rover
    device_id = data.get('device_id')
    if device_id:
        room_name = f"video_{device_id}"
        await sio.enter_room(sid, room_name)
        logger.info(f"Client {sid} subscribed to {room_name}")

@sio.event
async def unsubscribe_video(sid, data):
    # Dashboard stops watching a rover
    device_id = data.get('device_id')
    if device_id:
        room_name = f"video_{device_id}"
        await sio.leave_room(sid, room_name)
        logger.info(f"Client {sid} unsubscribed from {room_name}")

if __name__ == '__main__':
    # Run the server on 0.0.0.0 to allow incoming connections from the local network
    logger.info("Starting Pmesh Server on ws://0.0.0.0:8000")
    uvicorn.run(socket_app, host='0.0.0.0', port=8000)
