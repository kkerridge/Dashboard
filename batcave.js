// --- BEGIN FULL JS ---

// --- WebSocket setup ---
const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const websocketHost = location.hostname || 'boatlifesystems.co.uk';
const ws = new WebSocket(wsProtocol + websocketHost + ':3003');

const container = document.getElementById('deviceContainer');
const log = document.getElementById('log');
const alertSound = document.getElementById('alertSound');
const battControlEntrySound = document.getElementById('battControlEntrySound');
const batcaveEntrySound = document.getElementById('batcaveEntrySound');
const chartModal = document.getElementById('chartModal');
const chartCanvas = document.getElementById('chartCanvas');
const dashboardPage = document.getElementById('dashboard-page');
const ioControlsPage = document.getElementById('io-controls-page');
const mapPage = document.getElementById('map-page');
const navDashboardBtn = document.getElementById('nav-dashboard-btn');
const navIoControlsBtn = document.getElementById('nav-io-controls-btn');
const navMapBtn = document.getElementById('nav-map-btn');
const ioControlButtons = ioControlsPage.querySelectorAll('.io-button');
const exitBattControlBtn = document.getElementById('exitBattControlBtn');
const leftMotorTempDigital = document.getElementById('leftMotorTempDigital');
const leftMotorTempGauge = document.getElementById('leftMotorTempGauge');
const rightMotorTempDigital = document.getElementById('rightMotorTempDigital');
const rightMotorTempGauge = document.getElementById('rightMotorTempGauge');
const motorStatusMessage = document.getElementById('motorStatusMessage');
const pinModal = document.getElementById('pinModal');
const pinInput = document.getElementById('pinInput');
const pinSubmitBtn = document.getElementById('pinSubmitBtn');
const pinMessage = document.getElementById('pinMessage');
const silenceBtn = document.getElementById('silenceBtn');

const CORRECT_PIN = "1234";
const SESSION_AUTH_KEY = "battControlAuthenticated";
let isBattControlAuthenticated = sessionStorage.getItem(SESSION_AUTH_KEY) === "true";

const devices = {};
const history = {};

const motorTempDisplays = {
    'Temp1': {
        digital: leftMotorTempDigital,
        gauge: leftMotorTempGauge,
        currentValue: null,
        maxValue: null,
        alertLow: null,
        alertMed: null,
        isInverted: false,
        lastReceivedTime: 0
    },
    'Temp2': {
        digital: rightMotorTempDigital,
        gauge: rightMotorTempGauge,
        currentValue: null,
        maxValue: null,
        alertLow: null,
        alertMed: null,
        isInverted: false,
        lastReceivedTime: 0
    }
};

const MOTOR_INACTIVE_THRESHOLD = 30 * 1000;

// --- Silence Alarms (Global sync) ---
let silenceAlarms = localStorage.getItem("silence") === "true";
function updateSilenceButtonUI() {
    if (silenceAlarms) {
        silenceBtn.textContent = "🔕 Silence Alarms (global)";
    } else {
        silenceBtn.textContent = "🔔 Enable Alarms";
    }
}
updateSilenceButtonUI();
function toggleSilence() {
    silenceAlarms = !silenceAlarms;
    localStorage.setItem("silence", silenceAlarms);
    addLog(silenceAlarms ? "🔇 Alarms silenced" : "🔔 Alarms enabled");
    updateSilenceButtonUI();
    ws.send(JSON.stringify({ type: "chat", text: `hal: silence ${silenceAlarms}` }));
}
window.toggleSilence = toggleSilence;

// --- Theme ---
function toggleTheme() {
    document.body.classList.toggle('light');
    localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
}
if (localStorage.getItem('theme') === 'light') document.body.classList.add('light');
window.toggleTheme = toggleTheme;

// --- Navigation ---
function showPage(pageId) {
    dashboardPage.style.display = 'none';
    ioControlsPage.style.display = 'none';
    mapPage.style.display = 'none';
    pinModal.style.display = 'none';
    navDashboardBtn.classList.remove('active');
    navIoControlsBtn.classList.remove('active');
    navMapBtn.classList.remove('active');
    if (pageId === 'dashboard-page') {
        dashboardPage.style.display = 'block';
        navDashboardBtn.classList.add('active');
        renderDashboardContent();
    } else if (pageId === 'io-controls-page') {
        if (isBattControlAuthenticated) {
            ioControlsPage.style.display = 'flex';
            navIoControlsBtn.classList.add('active');
            updateMotorStatusDisplay();
        } else {
            batcaveEntrySound.play().catch(()=>{});
            pinModal.style.display = 'flex';
            pinInput.value = '';
            pinMessage.textContent = 'Enter PIN to access Batt Control.';
            navIoControlsBtn.classList.add('active');
        }
    } else if (pageId === 'map-page') {
        mapPage.style.display = 'flex';
        navMapBtn.classList.add('active');
        renderMapContent();
    }
}
navDashboardBtn.addEventListener('click', () => showPage('dashboard-page'));
navIoControlsBtn.addEventListener('click', () => showPage('io-controls-page'));
navMapBtn.addEventListener('click', () => showPage('map-page'));

pinSubmitBtn.addEventListener('click', () => {
    const enteredPin = pinInput.value;
    if (enteredPin === CORRECT_PIN) {
        isBattControlAuthenticated = true;
        sessionStorage.setItem(SESSION_AUTH_KEY, "true");
        pinMessage.textContent = '';
        battControlEntrySound.play().catch(()=>{});
        showPage('io-controls-page');
    } else {
        pinMessage.textContent = 'Incorrect PIN. Try again.';
        pinInput.value = '';
    }
});
pinInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') pinSubmitBtn.click(); });
exitBattControlBtn.addEventListener('click', () => {
    isBattControlAuthenticated = false;
    sessionStorage.removeItem(SESSION_AUTH_KEY);
    addLog("🔒 Batt Control access reset. PIN will be required again.");
    showPage('dashboard-page');
});
showPage('dashboard-page');

// --- Device Rendering Helpers ---
function getUnit(name) {
    const n = name.toLowerCase();
    if (n.includes("temp")) return "°C";
    if (n.includes("bat")) return "V";
    if (n.includes("bilge")) return "Level";
    if (n.includes("current")) return "A";
    if (n.includes("rpm")) return "RPM";
    return "";
}
function getColor(name) {
    const colors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'];
    const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return colors[hash % colors.length];
}
function isInverted(name) {
    return name.toLowerCase().includes("bilge");
}
function getStyle(name) {
    return localStorage.getItem('style_' + name) || 'digital';
}

function addLog(msg) {
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    if (log.childNodes.length > 100) log.removeChild(log.firstChild);
}

function renderDashboardContent() {
    for (const name in devices) {
        if (devices.hasOwnProperty(name)) {
            renderStyle(name);
        }
    }
    if (Object.keys(devices).length === 0) {
        addLog("No devices connected yet. Waiting for data from ESP.");
    }
}

// --- Map ---
let mymap = null;
let gpsMarker;
const gpsTrail = [];
let polyline;
const currentCoordsDisplay = document.getElementById('current-coords');

function setupMapOnce() {
    if (mymap !== null) return;
    mymap = L.map('map', {center: [0, 0], zoom: 2, zoomControl: true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mymap);
    gpsMarker = L.marker([0, 0]).addTo(mymap).bindPopup("GPS Location: N/A").openPopup();
    polyline = L.polyline(gpsTrail, {color: '#4363d8', weight: 3}).addTo(mymap);
    window.mymap = mymap; 
    addLog("Map instance created successfully.");
}
setupMapOnce();

function renderMapContent() {
    if (mymap) {
        setTimeout(() => {
            mymap.invalidateSize();
            if (gpsTrail.length > 0) {
                mymap.setView(gpsTrail[gpsTrail.length - 1], 15);
            } else {
                mymap.setView([0,0], 2);
            }
        }, 100);
    } else {
        addLog("Error: Map object not initialized during renderMapContent.");
    }
}

function updateMapLocation(lat, lon) {
    addLog(`Updating map with Lat: ${lat}, Lon: ${lon}`); 
    if (!mymap) {
        setupMapOnce(); 
        if (!mymap) { 
            addLog("Map object is null after setup attempt, cannot update location.");
            return;
        }
    }
    const newLatLng = new L.LatLng(lat, lon);
    gpsMarker.setLatLng(newLatLng);
    gpsMarker.setPopupContent(`GPS Location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    currentCoordsDisplay.textContent = `Current Location: Lat ${lat.toFixed(6)}, Lon ${lon.toFixed(6)}`;
    gpsTrail.push(newLatLng);
    polyline.setLatLngs(gpsTrail);
    if (gpsTrail.length > 500) {
        gpsTrail.shift();
        polyline.setLatLngs(gpsTrail);
    }
    if (!mymap.getBounds().contains(newLatLng)) {
        mymap.panTo(newLatLng);
    }
    if (mymap.getZoom() < 10) {
        mymap.setZoom(15);
    }
}

// --- Device Display Logic ---
function renderStyle(name) {
    const d = devices[name];
    if (!d) return;
    if (name === 'GPS') {
        d.value.style.display = 'block';
        d.unit.style.display = 'block';
        d.gaugeCanvas.style.display = 'none';
        return;
    }
    const style = d.style.value;
    const ctx = d.gaugeCanvas.getContext('2d');
    const unit = getUnit(name);
    d.value.style.display = 'none';
    d.unit.style.display = 'none';
    d.gaugeCanvas.style.display = 'none';
    ctx.clearRect(0, 0, d.gaugeCanvas.width, d.gaugeCanvas.height);
    if (style === "digital") {
        d.value.style.display = 'block';
        d.unit.style.display = 'block';
        d.value.style.fontSize = "32px";
        d.value.textContent = d.currentValue !== null ? d.currentValue.toFixed(1) : 'N/A';
        d.unit.textContent = unit;
    } else if (style === "analog") {
        d.gaugeCanvas.style.display = 'block';
        d.gaugeCanvas.width = d.div.clientWidth - 30;
        d.gaugeCanvas.height = d.gaugeCanvas.width * 0.75;
        renderAnalogGauge(name);
    } else if (style === "bar") {
        d.gaugeCanvas.style.display = 'block';
        d.gaugeCanvas.width = d.div.clientWidth - 30;
        d.gaugeCanvas.height = d.gaugeCanvas.width * 0.4;
        renderBarGauge(name);
    }
}

    // ...your original analog gauge function here...


function renderAnalogGauge(name) {
    const d = devices[name];
    if (!d || d.currentValue === null || d.gaugeCanvas.width <= 0 || d.gaugeCanvas.height <= 0) return;
    const ctx = d.gaugeCanvas.getContext('2d');
    const W = d.gaugeCanvas.width;
    const H = d.gaugeCanvas.height;
    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) * 0.38;
    ctx.clearRect(0, 0, W, H);

    // Draw circular background
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 5;
    ctx.fill();
    ctx.restore();

    // Draw scale ticks (every 30°)
    ctx.save();
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 2;
    for (let deg = 0; deg < 360; deg += 30) {
        const a = (deg - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r * 0.75), cy + Math.sin(a) * (r * 0.75));
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
    }
    ctx.restore();

    // Draw pointer (arrow)
    let angleValue = d.currentValue % 360;
    let a = (angleValue - 90) * Math.PI / 180; // 0 deg = right, -90 = up

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-r * 0.10, r * 0.18);
    ctx.lineTo(0, -r * 0.93);
    ctx.lineTo(r * 0.10, r * 0.18);
    ctx.lineTo(0, -r * 0.75);
    ctx.closePath();
    ctx.fillStyle = '#f82';
    ctx.shadowColor = 'orange';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();

    // Center cap
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.19, 0, Math.PI * 2);
    ctx.fillStyle = '#333';
    ctx.shadowBlur = 0;
    ctx.fill();

    // Draw value (large number)
    ctx.save();
    ctx.font = `bold ${Math.round(r * 0.55)}px Inter`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(Math.round(d.currentValue), cx, cy);
    ctx.font = `bold ${Math.round(r * 0.27)}px Inter`;
    ctx.fillStyle = "#ccc";
    ctx.fillText(getUnit(name) || "°", cx, cy + r * 0.39);
    ctx.restore();
}






function renderBarGauge(name) {
    // ...your original bar gauge function here...
}

function createDevice(name) {
    const div = document.createElement('div');
    div.className = 'device';
    div.style.border = `2px solid ${getColor(name)}`;
    if (name === 'GPS') {
        div.onclick = (e) => { if (e.target.tagName !== 'SELECT') copyGPSToClipboard(name); };
    } else {
        div.onclick = (e) => { if (e.target.tagName !== 'SELECT') showChart(name); };
    }
    const label = document.createElement('div');
    label.className = 'device-label';
    label.innerText = name;
    const valueDisplay = document.createElement('div');
    valueDisplay.className = 'value-display';
    div.appendChild(valueDisplay);
    const value = document.createElement('div');
    value.className = 'value gauge-text';
    value.innerText = 'N/A';
    const unit = document.createElement('div');
    unit.className = 'unit gauge-text';
    const gaugeCanvas = document.createElement('canvas');
    gaugeCanvas.className = 'gauge-canvas';
    gaugeCanvas.width = 200; 
    gaugeCanvas.height = 200; 
    valueDisplay.append(value, unit, gaugeCanvas);
    const alert = document.createElement('div');
    alert.className = 'alert';
    const minmax = document.createElement('div');
    minmax.className = 'minmax';
    const styleSel = document.createElement('select');
    if (name === 'GPS') {
        const o = document.createElement('option');
        o.value = 'digital';
        o.text = 'Coordinates'; 
        o.selected = true;
        styleSel.appendChild(o);
        styleSel.disabled = true; 
        styleSel.style.display = 'none'; 
    } else {
        ['digital', 'analog', 'bar'].forEach(opt => {
            const o = document.createElement('option');
            o.value = o.text = opt;
            if (opt === getStyle(name)) o.selected = true;
            styleSel.appendChild(o);
        });
        styleSel.onchange = (e) => {
            e.stopPropagation();
            localStorage.setItem('style_' + name, styleSel.value);
            renderStyle(name);
        };
    }
    div.append(label, valueDisplay, alert, minmax, styleSel);
    container.appendChild(div);

    devices[name] = {
        div, value, unit, alert, minmax, gaugeCanvas,
        style: styleSel, 
        currentValue: null, 
        maxValue: null,     
        alertLow: 20,
        alertMed: 40,
        lastSeen: Date.now(),
        lastReceivedLat: null,
        lastReceivedLon: null
    };
    history[name] = [];
    renderStyle(name);
}

function updateDevice(name, val, max, alertLow = 20, alertMed = 40) {
    if (!devices[name]) createDevice(name);
    const d = devices[name];
    d.lastSeen = Date.now();
    d.div.classList.remove('fadeout');
    if (name === 'GPS' && typeof val === 'object' && val.hasOwnProperty('lat') && val.hasOwnProperty('lon')) {
        d.lastReceivedLat = val.lat;
        d.lastReceivedLon = val.lon;
        d.value.textContent = `Lat: ${val.lat.toFixed(6)}, Lon: ${val.lon.toFixed(6)}`;
        d.unit.textContent = '';
        d.minmax.textContent = `Last Update: ${new Date(d.lastSeen).toLocaleTimeString()}`;
        d.alert.style.display = 'none'; 
        d.alert.style.background = 'transparent'; 
        d.alert.style.border = 'none';
        d.alert.style.boxShadow = 'none';
        d.value.style.display = 'block';
        d.unit.style.display = 'block';
        d.gaugeCanvas.style.display = 'none';
        return; 
    }
    if (d.min === undefined) d.min = val;
    if (d.max === undefined) d.max = val;
    d.min = Math.min(d.min, val);
    d.max = Math.max(d.max, val);
    d.currentValue = val;
    d.maxValue = max;
    d.alertLow = alertLow;
    d.alertMed = alertMed;
    d.minmax.textContent = `Min: ${d.min.toFixed(1)} Max: ${d.max.toFixed(1)}`;
    d.value.textContent = val.toFixed(1);
    d.unit.textContent = getUnit(name);
    const inverted = isInverted(name);
    if (inverted) {
        if (val > d.alertMed) d.alert.style.background = 'red';
        else if (val > d.alertLow) d.alert.style.background = 'orange';
        else d.alert.style.background = 'green';
    } else {
        if (val < d.alertLow) d.alert.style.background = 'red';
        else if (val < d.alertMed) d.alert.style.background = 'orange';
        else d.alert.style.background = 'green';
    }
    d.alert.style.display = 'block';
    d.alert.style.border = `2px solid var(--card)`; 
    d.alert.style.boxShadow = `0 0 5px rgba(0, 0, 0, 0.3)`; 
    history[name].push({ value: val, timestamp: Date.now() });
    if (history[name].length > 200) history[name].shift();
    if (!silenceAlarms && ((inverted && val > d.alertMed) || (!inverted && val < d.alertLow))) {
        alertSound.play().catch(()=>{});
    }
    renderStyle(name); 
}

function updateMotorTemperatureDisplay(name, val, max, alertLow, alertMed) {
    const display = motorTempDisplays[name];
    if (!display) return;
    display.currentValue = val;
    display.maxValue = max;
    display.alertLow = alertLow;
    display.alertMed = alertMed;
    display.lastReceivedTime = Date.now(); 
    display.digital.textContent = `${val.toFixed(1)}°C`;
    // Compact bar rendering can be added here
    updateMotorStatusDisplay();
}
function updateMotorStatusDisplay() {
    const now = Date.now(); 
    let allMotorsInactive = true;
    for (const key in motorTempDisplays) {
        if (motorTempDisplays.hasOwnProperty(key)) {
            const motor = motorTempDisplays[key];
            if (now - motor.lastReceivedTime < MOTOR_INACTIVE_THRESHOLD) {
                allMotorsInactive = false;
                break;
            }
        }
    }
    if (allMotorsInactive) {
        motorStatusMessage.textContent = "Bat-Signals Offline, Initiate Power Protocol!";
        motorStatusMessage.style.display = 'block';
    } else {
        motorStatusMessage.style.display = 'none';
    }
}

// --- IO Controls ---
function sendIoControl(gpioPin, state) {
    const espDeviceName = 'Temp';
    const msg = { type: "chat", text: `io: ${espDeviceName.toLowerCase()} ${gpioPin} ${state}` };
    ws.send(JSON.stringify(msg));
    addLog(`⚡ Sent IO command: GPIO ${gpioPin} ${state}`);
}
const gpioDisplayName = { '26': 'Left Motor', '27': 'Right Motor' };
ioControlButtons.forEach(button => {
    button.addEventListener('click', () => {
        const gpio = button.dataset.gpio;
        const currentState = button.dataset.state;
        const newState = (currentState === 'on') ? 'off' : 'on';
        sendIoControl(gpio, newState);
    });
});
function updateIoButtonUI(gpioPin, state) {
    const button = ioControlsPage.querySelector(`.io-button[data-gpio="${gpioPin}"]`);
    if (button) {
        const displayName = gpioDisplayName[gpioPin] || `GPIO ${gpioPin}`;
        button.dataset.state = state;
        button.textContent = `${displayName}: ${state.toUpperCase()}`;
        if (state === 'on') button.classList.add('on');
        else button.classList.remove('on');
    }
}

// --- Utility ---
function resetAll() {
    Object.keys(devices).forEach(name => {
        const msg = { type: "chat", text: `hal: ${name.toLowerCase()} reset` };
        ws.send(JSON.stringify(msg));
        addLog(`🔁 Reset sent to ${name}`);
    });
}
window.resetAll = resetAll;
function exportCSV() {
    let csv = 'Device,Timestamp,Value\n';
    Object.keys(history).forEach(name => {
        history[name].forEach(entry => {
            csv += `${name},"${new Date(entry.timestamp).toISOString()}","${entry.value}"\n`;
        });
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hal_data.csv';
    a.click();
}
window.exportCSV = exportCSV;
function showChart(name) {
    if (!history[name] || history[name].length === 0) {
        addLog(`No history data for ${name} to show chart.`);
        return;
    }
    chartModal.style.display = "flex";
    const ctx = chartCanvas.getContext("2d");
    if (window.currentChart) {
        window.currentChart.destroy();
    }
    window.currentChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: history[name].map(entry => new Date(entry.timestamp).toLocaleTimeString()),
            datasets: [{
                label: name + ' ' + getUnit(name),
                data: history[name].map(entry => entry.value),
                borderColor: getColor(name),
                backgroundColor: 'rgba(67,99,216,0.2)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { color: 'var(--fg)' }, grid: { color: 'rgba(150, 150, 150, 0.2)' } },
                y: { beginAtZero: true, ticks: { color: 'var(--fg)' }, grid: { color: 'rgba(150, 150, 150, 0.2)' } }
            },
            plugins: {
                legend: { labels: { color: 'var(--fg)' } },
                tooltip: { backgroundColor: 'rgba(0,0,0,0.7)', bodyColor: 'white', titleColor: 'white' }
            }
        }
    });
}
window.showChart = showChart;

function copyGPSToClipboard(name) {
    const d = devices[name];
    if (!d || !d.lastReceivedLat || !d.lastReceivedLon) {
        addLog('❌ No GPS data available to copy.');
        return;
    }
    const coordsString = `${d.lastReceivedLat.toFixed(6)},${d.lastReceivedLon.toFixed(6)}`;
    const tempInput = document.createElement('textarea');
    tempInput.value = coordsString;
    document.body.appendChild(tempInput);
    tempInput.select();
    try {
        document.execCommand('copy');
        addLog(`✅ Copied "${coordsString}" to clipboard.`);
    } catch (err) {
        addLog('❌ Failed to copy coordinates: ' + err);
    }
    document.body.removeChild(tempInput);
}
window.copyGPSToClipboard = copyGPSToClipboard;

// --- WebSocket handler with global silence sync ---
ws.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        addLog(`Received WebSocket data: ${JSON.stringify(data)}`);
        if (data.type === "chat") {
            const text = data.text;
            const sensorMatch = text.match(/^hal:\s*(\w+)(?<!GPS)\s+(-?\d+(?:\.\d+)?)(?:\s+max=(\d+(?:\.\d+)?))?(?:\s+alertLow=(\d+(?:\.\d+)?))?(?:\s+alertMed=(\d+(?:\.\d+)?))?/i);
            const ioAckMatch = text.match(/^io_ack:\s*(\w+)\s*(\d+)\s*(on|off)/i);
            const resetAckMatch = text.match(/^hal:\s*(\w+)\s*reset_ack/i);
            const gpsMatch = text.match(/^hal:\s*GPS\s*(-?\d+\.\d+),(-?\d+\.\d+)/i);
            const silenceMatch = text.match(/^hal:\s*silence\s*(true|false)/i);
            if (silenceMatch) {
                silenceAlarms = (silenceMatch[1] === "true");
                localStorage.setItem("silence", silenceAlarms);
                addLog(silenceAlarms ? "🔇 Alarms silenced (global)" : "🔔 Alarms enabled (global)");
                updateSilenceButtonUI();
                return;
            }
            if (sensorMatch) {
                const name = sensorMatch[1];
                const val = parseFloat(sensorMatch[2]);
                const max = sensorMatch[3] ? parseFloat(sensorMatch[3]) : 100;
                const alertLow = sensorMatch[4] ? parseFloat(sensorMatch[4]) : 20;
                const alertMed = sensorMatch[5] ? parseFloat(sensorMatch[5]) : 40;
                if (motorTempDisplays[name]) {
                    updateMotorTemperatureDisplay(name, val, max, alertLow, alertMed);
                    addLog(`Updated motor temperature: ${name} = ${val.toFixed(1)}`);
                } else {
                    updateDevice(name, val, max, alertLow, alertMed);
                    addLog(`Updated dashboard device: ${name} = ${val.toFixed(1)}`);
                }
            } else if (ioAckMatch) {
                const device = ioAckMatch[1];
                const gpioPin = ioAckMatch[2];
                const state = ioAckMatch[3].toLowerCase();
                updateIoButtonUI(gpioPin, state);
                addLog(`Acknowledged IO state for GPIO ${gpioPin}: ${state.toUpperCase()}`);
            } else if (resetAckMatch) {
                addLog(`Reset acknowledged for device: ${resetAckMatch[1]}`);
            } else if (gpsMatch) {
                const lat = parseFloat(gpsMatch[1]);
                const lon = parseFloat(gpsMatch[2]);
                updateMapLocation(lat, lon);
                updateDevice('GPS', { lat: lat, lon: lon }, 0, 0, 0);
                addLog(`📍 GPS Update: Lat ${lat.toFixed(6)}, Lon ${lon.toFixed(6)}`);
            } else {
                addLog(`❌ Message did not match any known regex: "${text}"`);
                return;
            }
        }
    } catch (error) {
        addLog(`❌ Error parsing WebSocket message: ${error.message}. Raw data: ${event.data}`);
    }
};
ws.onopen = () => { addLog("✅ WebSocket connected"); updateMotorStatusDisplay(); };
ws.onerror = (e) => addLog("❌ WebSocket error: " + (e.message || e.type));
ws.onclose = () => { addLog("🔴 WebSocket disconnected"); updateMotorStatusDisplay(); };

// --- Poll for inactive/fadeout
setInterval(() => {
    const now = Date.now();
    Object.values(devices).forEach(d => {
        if (now - d.lastSeen > 60000) d.div.classList.add('fadeout');
        else d.div.classList.remove('fadeout');
    });
}, 10000);
setInterval(updateMotorStatusDisplay, 5000);

// --- END FULL JS ---
