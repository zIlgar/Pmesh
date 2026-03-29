const socket = io();

// State
let activeDeviceId = null;
let currentViewMode = 'standard'; // standard, thermal, split

// Object URL caches to prevent memory leaks
let urlCache = {
    standard: null,
    thermal: null
};

// DOM Elements
const deviceListEl = document.getElementById('device-list');
const activeDeviceTitle = document.getElementById('active-device-title');
const viewControls = document.getElementById('view-controls');
const streamEmpty = document.getElementById('stream-empty');
const feedStandard = document.getElementById('feed-standard');
const feedThermal = document.getElementById('feed-thermal');
const extInfoPanel = document.getElementById('rover-extended-info');
const extUptime = document.getElementById('ext-uptime');
const extWifiVal = document.getElementById('ext-wifi-val');
const imgStandard = document.getElementById('img-standard');
const imgThermal = document.getElementById('img-thermal');
const telemetryStats = document.getElementById('telemetry-stats');
const statCpuTemp = document.getElementById('stat-cpu-temp');
const statStatus = document.getElementById('stat-status');
const alertsLog = document.getElementById('alerts-log');
const viewBtns = document.querySelectorAll('.view-controls .btn');

// Fleet State
const fleet = [
    { device_id: 'Rover-01', status: 'offline' },
    { device_id: 'Rover-02', status: 'offline' },
    { device_id: 'Rover-03', status: 'offline' },
    { device_id: 'Rover-04', status: 'offline' },
    { device_id: 'Rover-05', status: 'offline' }
];

// --- Socket.IO Event Handlers ---

socket.on('connect', () => {
    logAlert("Connected to telemetry server", false);
    socket.emit('join_dashboard');
});

socket.on('disconnect', () => {
    logAlert("Lost connection to server", true);
    fleet.forEach(r => r.status = 'offline');
    renderDeviceList(fleet);
});

socket.on('device_list_update', (devices) => {
    fleet.forEach(r => r.status = 'offline');
    devices.forEach(d => {
        let rover = fleet.find(r => r.device_id === d.device_id);
        if (rover) {
            rover.status = d.status || 'active';
        } else {
            fleet.push({ device_id: d.device_id, status: d.status || 'active' });
        }
    });
    renderDeviceList(fleet);
});

socket.on('telemetry_update', (data) => {
    let rover = fleet.find(r => r.device_id === data.device_id);
    if (rover) {
        let oldStatus = rover.status;
        rover.status = data.status || 'active';
        if (oldStatus !== rover.status) renderDeviceList(fleet);
    }

    if (data.device_id === activeDeviceId) {
        statCpuTemp.innerHTML = `${data.cpu_temp} &deg;C`;
        statStatus.innerText = data.status.toUpperCase();
        
        // Log alerts for high temperature
        if (data.cpu_temp > 50) {
            logAlert(`High CPU Temp Warning: ${data.cpu_temp}°C`, true);
        }
    }
});

socket.on('video_stream', (payload) => {
    // Only process frames for the currently active device
    if (payload.device_id !== activeDeviceId) return;
    
    // Hide empty state once we receive the first frame
    if (streamEmpty.style.display !== 'none') {
        streamEmpty.style.display = 'none';
        applyViewMode();
    }

    try {
        // Convert raw binary (ArrayBuffer) to Blob
        const blob = new Blob([payload.data], { type: 'image/jpeg' });
        const imgUrl = URL.createObjectURL(blob);

        if (payload.type === 'standard') {
            if (urlCache.standard) URL.revokeObjectURL(urlCache.standard); // Prevent memory leak
            urlCache.standard = imgUrl;
            imgStandard.src = imgUrl;
        } else if (payload.type === 'thermal') {
            if (urlCache.thermal) URL.revokeObjectURL(urlCache.thermal); // Prevent memory leak
            urlCache.thermal = imgUrl;
            imgThermal.src = imgUrl;
        }
    } catch (error) {
        console.error("Error creating image Blob/URL from stream data:", error);
    }
});


// --- UI Functions ---

function renderDeviceList(devices) {
    deviceListEl.innerHTML = '';
    
    // Check if active device is still active in the list
    const activeDeviceObj = devices.find(d => d.device_id === activeDeviceId);
    if (activeDeviceId && (!activeDeviceObj || activeDeviceObj.status === 'offline')) {
        selectDevice(null);
    }

    devices.forEach(device => {
        const li = document.createElement('li');
        const isOffline = device.status === 'offline';
        const isActiveSelection = device.device_id === activeDeviceId;
        
        li.className = `device-item ${isActiveSelection ? 'active' : ''} ${isOffline ? 'offline' : ''}`;
        
        li.innerHTML = `
            <div class="name">${device.device_id}</div>
            <div class="status-indicator ${device.status === 'active' ? 'online' : 'offline-dot'}"></div>
        `;
        
        li.addEventListener('click', () => {
            selectDevice(device.device_id);
            renderDeviceList(devices);
        });
        
        deviceListEl.appendChild(li);
    });
    
    // Sync 3D Map Markers
    updateMapMarkers(devices);
}

function updateMapMarkers(devices) {
    const markers = document.querySelectorAll('.rover-marker');
    markers.forEach(marker => {
        const dId = marker.getAttribute('data-rover');
        const roverObj = devices.find(r => r.device_id === dId);
        marker.classList.remove('online', 'offline');
        if (roverObj && roverObj.status === 'active') {
            marker.classList.add('online');
        } else {
            marker.classList.add('offline');
        }
    });
}

function selectDevice(deviceId) {
    // Unsubscribe from previous
    if (activeDeviceId) {
        socket.emit('unsubscribe_video', { device_id: activeDeviceId });
    }

    activeDeviceId = deviceId;

    // Reset Stream UI
    streamEmpty.style.display = 'block';
    feedStandard.style.display = 'none';
    feedThermal.style.display = 'none';
    if (extInfoPanel) {
        extInfoPanel.style.display = 'block';
        startChartSimulation();
    }
    telemetryStats.style.display = 'none';
    viewControls.style.display = 'none';
    
    if (urlCache.standard) URL.revokeObjectURL(urlCache.standard);
    if (urlCache.thermal) URL.revokeObjectURL(urlCache.thermal);
    urlCache.standard = null;
    urlCache.thermal = null;
    imgStandard.src = '';
    imgThermal.src = '';

    if (!deviceId) {
        activeDeviceTitle.innerText = "Select a Rover";
        if (extInfoPanel) extInfoPanel.style.display = 'none';
        stopChartSimulation();
        logAlert("No active rover selected", false);
        return;
    }

    // Subscribe to new device
    activeDeviceTitle.innerText = deviceId;
    viewControls.style.display = 'flex';
    telemetryStats.style.display = 'grid';
    statCpuTemp.innerHTML = '-- &deg;C';
    statStatus.innerText = 'WAITING';
    
    logAlert(`Connecting to ${deviceId} streams...`, false);
    socket.emit('subscribe_video', { device_id: deviceId });
}

function logAlert(message, isWarning = false) {
    const el = document.createElement('div');
    el.className = `log-entry ${isWarning ? 'warn' : ''}`;
    
    const time = new Date().toLocaleTimeString();
    el.innerText = `[${time}] ${message}`;
    
    alertsLog.prepend(el);
    
    // Keep only last 20 messages
    if (alertsLog.children.length > 20) {
        alertsLog.removeChild(alertsLog.lastChild);
    }
}

function applyViewMode() {
    // Only apply if we actually have streams flowing
    if (streamEmpty.style.display !== 'none') return;
    
    if (currentViewMode === 'standard') {
        feedStandard.style.display = 'flex';
        feedThermal.style.display = 'none';
    } else if (currentViewMode === 'thermal') {
        feedStandard.style.display = 'none';
        feedThermal.style.display = 'flex';
    } else if (currentViewMode === 'split') {
        feedStandard.style.display = 'flex';
        feedThermal.style.display = 'flex';
    }
}

// Update View Button Styles
viewBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        viewBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        
        currentViewMode = e.target.getAttribute('data-view');
        applyViewMode();
    });
});

// Initialize Map Marker Clicks
document.querySelectorAll('.rover-marker').forEach(marker => {
    marker.addEventListener('click', () => {
        const deviceId = marker.getAttribute('data-rover');
        selectDevice(deviceId);
        renderDeviceList(fleet);
    });
});

// Initial render
renderDeviceList(fleet);

// --- Extended Charts Logic ---
let batteryChart = null;
let wifiChart = null;
let simulationInterval = null;
let uptimeSeconds = 120 * 60 + 14 * 60 + 33; // Starts at 02h 14m 33s

function initCharts() {
    const ctxBattery = document.getElementById('chart-battery').getContext('2d');
    const ctxWifi = document.getElementById('chart-wifi').getContext('2d');

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { display: false },
            y: { display: false, border: { display: false } }
        },
        elements: { point: { radius: 0 } },
        animation: { duration: 200 }
    };

    batteryChart = new Chart(ctxBattery, {
        type: 'line',
        data: {
            labels: Array(20).fill(''),
            datasets: [{
                data: Array(20).fill(80),
                borderColor: '#10b981',
                borderWidth: 2,
                tension: 0.4
            }]
        },
        options: { ...commonOptions, scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } } }
    });

    wifiChart = new Chart(ctxWifi, {
        type: 'line',
        data: {
            labels: Array(20).fill(''),
            datasets: [{
                data: Array(20).fill(-65),
                borderColor: '#eab308',
                borderWidth: 2,
                tension: 0.4
            }]
        },
        options: { ...commonOptions, scales: { x: { display: false }, y: { display: false, min: -90, max: -40 } } }
    });
}

function updateUptimeDisplay() {
    const h = Math.floor(uptimeSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((uptimeSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (uptimeSeconds % 60).toString().padStart(2, '0');
    extUptime.innerText = `${h}:${m}:${s}`;
}

function startChartSimulation() {
    if (!batteryChart) initCharts();
    if (simulationInterval) clearInterval(simulationInterval);
    
    simulationInterval = setInterval(() => {
        // Battery static at 80
        const bData = batteryChart.data.datasets[0].data;
        bData.push(80);
        bData.shift();
        batteryChart.update();

        // WiFi config: between -80 and -50
        const wData = wifiChart.data.datasets[0].data;
        let lastW = wData[wData.length - 1];
        let newW = lastW + (Math.random() * 4 - 2);
        if (newW > -50) newW = -50;
        if (newW < -80) newW = -80;
        
        wData.push(newW);
        wData.shift();
        
        extWifiVal.innerText = `${Math.round(newW)} dBm`;
        wifiChart.update();

        uptimeSeconds++;
        updateUptimeDisplay();

    }, 1000);
}

function stopChartSimulation() {
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
}
