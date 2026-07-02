/**
 * Audímetro - Medidor del Umbral de Audición
 * Lógica de control con Web Audio API y Visualizador Canvas
 */

// Elementos del DOM - Configuración
const setupPanel = document.getElementById('setup-panel');
const setupForm = document.getElementById('setup-form');
const inputMinFreq = document.getElementById('input-min-freq');
const inputMaxFreq = document.getElementById('input-max-freq');
const inputDuration = document.getElementById('input-duration');
const inputVolume = document.getElementById('input-volume');
const volumeVal = document.getElementById('volume-val');
const btnTestTone = document.getElementById('btn-test-tone');
const btnStartTest = document.getElementById('btn-start-test');

// Elementos del DOM - Pantalla del Test
const testPanel = document.getElementById('test-panel');
const phaseBadge = document.getElementById('phase-badge');
const phaseTitle = document.getElementById('phase-title');
const phaseInstruction = document.getElementById('phase-instruction');
const freqDisplay = document.getElementById('freq-display');
const progressBarFill = document.getElementById('progress-bar-fill');
const waveCanvas = document.getElementById('wave-canvas');
const btnTriggerAction = document.getElementById('btn-trigger-action');
const btnTriggerText = document.getElementById('btn-trigger-text');
const btnAbortTest = document.getElementById('btn-abort-test');
const microVolume = document.getElementById('micro-volume');

// Elementos del DOM - Resultados
const resultsPanel = document.getElementById('results-panel');
const resLowerVal = document.getElementById('res-lower-val');
const resLowerEval = document.getElementById('res-lower-eval');
const resUpperVal = document.getElementById('res-upper-val');
const resUpperEval = document.getElementById('res-upper-eval');
const userSpectrumBar = document.getElementById('user-spectrum-bar');
const userTrackLabel = document.getElementById('user-track-label');
const resultsAnalysisText = document.getElementById('results-analysis-text');
const btnRestartAll = document.getElementById('btn-restart-all');
const btnCopyResults = document.getElementById('btn-copy-results');

// Contexto de Audio y Nodos
let audioCtx = null;
let oscillator = null;
let gainNode = null;
let isAudioRunning = false;

// Estado de la Aplicación
let testState = 'setup'; // 'setup', 'phase1_running', 'phase1_done', 'phase2_running', 'finished'
let minFreq = 20;
let maxFreq = 20000;
let duration = 30; // segundos
let currentVolume = 0.1; // 10% por defecto

// Variables de Control del Barrido
let currentFreq = 20;
let accumulatedElapsedTime = 0; // ms acumulados en el barrido activo
let lastTime = 0; // timestamp de referencia para el cálculo de delta time
let sweepAnimationId = null;

// Variables del Visualizador Canvas
let canvasCtx = null;
let canvasWidth = 0;
let canvasHeight = 0;
let wavePhase = 0;
let visualizerAnimationId = null;

// Valores Registrados
let lowerLimit = null;
let upperLimit = null;

/* ==========================================================================
   INICIALIZACIÓN Y EVENTOS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Vincular cambios en controles de volumen
    inputVolume.addEventListener('input', (e) => {
        const pct = e.target.value;
        volumeVal.textContent = `${pct}%`;
        currentVolume = pct / 100;
        microVolume.value = pct;
        updateGain();
    });

    microVolume.addEventListener('input', (e) => {
        const pct = e.target.value;
        volumeVal.textContent = `${pct}%`;
        inputVolume.value = pct;
        currentVolume = pct / 100;
        updateGain();
    });

    // Inicializar Canvas
    setupCanvas();
    window.addEventListener('resize', setupCanvas);

    // Botones de acción
    btnTestTone.addEventListener('click', playShortTestTone);
    btnStartTest.addEventListener('click', beginTestFlow);
    btnTriggerAction.addEventListener('click', handleTriggerAction);
    btnAbortTest.addEventListener('click', abortTest);
    btnRestartAll.addEventListener('click', resetToSetup);
    btnCopyResults.addEventListener('click', copyResultsToClipboard);

    // Iniciar bucle de dibujo de fondo (onda inactiva plana)
    startVisualizer();
});

// Inicializar el contexto de audio en el primer evento de usuario
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Configurar volumen en tiempo real
function updateGain() {
    if (gainNode && audioCtx) {
        gainNode.gain.setTargetAtTime(currentVolume, audioCtx.currentTime, 0.05);
    }
}

/* ==========================================================================
   FUNCIONES DE AUDIO AUXILIARES
   ========================================================================== */

// Reproduce un tono de prueba breve (1 segundo) para calibrar el volumen
function playShortTestTone() {
    initAudio();
    
    // Crear nodos temporales
    const tempOsc = audioCtx.createOscillator();
    const tempGain = audioCtx.createGain();
    
    tempOsc.type = 'sine';
    // Usar 440 Hz (La central) para la prueba, o la frecuencia mínima si es superior
    const testF = Math.max(440, parseInt(inputMinFreq.value));
    tempOsc.frequency.setValueAtTime(testF, audioCtx.currentTime);
    
    tempGain.gain.setValueAtTime(0, audioCtx.currentTime);
    // Rampa de subida rápida para evitar el "pop" inicial
    tempGain.gain.linearRampToValueAtTime(currentVolume, audioCtx.currentTime + 0.05);
    // Rampa de bajada antes del final
    tempGain.gain.setValueAtTime(currentVolume, audioCtx.currentTime + 0.8);
    tempGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.0);
    
    tempOsc.connect(tempGain);
    tempGain.connect(audioCtx.destination);
    
    tempOsc.start();
    tempOsc.stop(audioCtx.currentTime + 1.05);
    
    // Animación de onda temporal para dar feedback visual
    animateBriefWave();
}

function startOscillator(freq) {
    initAudio();
    
    // Detener si ya hay uno
    stopOscillator();

    oscillator = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);

    // Rampa suave de entrada del volumen
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(currentVolume, audioCtx.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    isAudioRunning = true;
}

function stopOscillator() {
    if (oscillator && isAudioRunning) {
        try {
            // Rampa rápida de salida del volumen
            const currTime = audioCtx.currentTime;
            gainNode.gain.setValueAtTime(gainNode.gain.value, currTime);
            gainNode.gain.linearRampToValueAtTime(0, currTime + 0.05);
            
            const localOsc = oscillator;
            setTimeout(() => {
                try {
                    localOsc.stop();
                    localOsc.disconnect();
                } catch(e) {}
            }, 60);
        } catch(e) {
            console.error("Error al detener oscilador: ", e);
        }
    }
    oscillator = null;
    gainNode = null;
    isAudioRunning = false;
}

/* ==========================================================================
   LÓGICA DEL TEST (FLUJO DE FASES)
   ========================================================================== */

function beginTestFlow() {
    // Validar parámetros del formulario
    if (!setupForm.reportValidity()) return;

    minFreq = parseFloat(inputMinFreq.value);
    maxFreq = parseFloat(inputMaxFreq.value);
    duration = parseFloat(inputDuration.value);
    currentVolume = parseFloat(inputVolume.value) / 100;

    if (minFreq >= maxFreq) {
        alert("La frecuencia inicial debe ser menor que la frecuencia máxima.");
        return;
    }

    // Inicializar variables
    lowerLimit = null;
    upperLimit = null;
    accumulatedElapsedTime = 0;
    currentFreq = minFreq;

    // Cambiar pantallas
    setupPanel.classList.add('hidden');
    resultsPanel.classList.add('hidden');
    testPanel.classList.remove('hidden');

    // Cambiar a Fase 1
    setPhase1State();
}

function setPhase1State() {
    testState = 'phase1_running';
    
    // Actualizar UI del botón y textos
    phaseBadge.textContent = "Fase 1: Límite Inferior";
    phaseBadge.className = "badge badge-phase-1";
    phaseTitle.textContent = "Buscando el inicio del sonido...";
    phaseInstruction.textContent = "El sonido irá subiendo gradualmente desde los graves más profundos. Pulsa el botón central tan pronto como comiences a escuchar un zumbido o tono continuo.";
    
    btnTriggerText.textContent = "EMPIECE A OÍR";
    btnTriggerAction.className = "btn btn-trigger pulse-button phase-1-active";
    
    // Iniciar sonido y barrido
    currentFreq = minFreq;
    startOscillator(currentFreq);
    
    lastTime = performance.now();
    runSweepLoop();
}

function setPhase1PausedState() {
    testState = 'phase1_done';
    stopOscillator();
    cancelAnimationFrame(sweepAnimationId);

    // Actualizar interfaz para preparación de Fase 2
    phaseTitle.textContent = "¡Límite Inferior Registrado!";
    phaseInstruction.textContent = `Has empezado a oír a los ${lowerLimit.toFixed(1)} Hz. Ahora nos prepararemos para buscar el límite superior de audición (los agudos más altos). Prepárate y pulsa Continuar.`;
    
    btnTriggerText.textContent = "CONTINUAR TEST";
    btnTriggerAction.className = "btn btn-trigger pulse-button"; // Color base
}

function startPhase2State() {
    testState = 'phase2_running';

    phaseBadge.textContent = "Fase 2: Límite Superior";
    phaseBadge.className = "badge badge-phase-2";
    phaseTitle.textContent = "Buscando el límite superior...";
    phaseInstruction.textContent = "El sonido seguirá subiendo. Mantén la atención. Pulsa el botón central en el instante exacto en el que dejes de escuchar el pitido agudo.";
    
    btnTriggerText.textContent = "DEJO DE OÍR";
    btnTriggerAction.className = "btn btn-trigger pulse-button phase-2-active";

    // Reanudar sonido desde la última frecuencia grabada
    startOscillator(currentFreq);
    
    lastTime = performance.now();
    runSweepLoop();
}

function finishTest() {
    testState = 'finished';
    stopOscillator();
    cancelAnimationFrame(sweepAnimationId);

    // Mostrar resultados
    testPanel.classList.add('hidden');
    resultsPanel.classList.remove('hidden');

    // Dibujar resultados en pantalla
    resLowerVal.textContent = lowerLimit.toFixed(0);
    resUpperVal.textContent = upperLimit.toFixed(0);

    // Evaluaciones rápidas
    if (lowerLimit <= 30) {
        resLowerEval.textContent = "Excelente (Muy sensible)";
    } else if (lowerLimit <= 80) {
        resLowerEval.textContent = "Normal para graves";
    } else {
        resLowerEval.textContent = "Umbral elevado";
    }

    if (upperLimit >= 17000) {
        resUpperEval.textContent = "Excelente (< 20 años)";
    } else if (upperLimit >= 15000) {
        resUpperEval.textContent = "Muy buena (20-30 años)";
    } else if (upperLimit >= 12000) {
        resUpperEval.textContent = "Buena (30-50 años)";
    } else if (upperLimit >= 8000) {
        resUpperEval.textContent = "Normal (50-60 años)";
    } else {
        resUpperEval.textContent = "Reducido para agudos";
    }

    // Dibujar gráfico de barras
    // Mapeo logarítmico para escala científica
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    
    // Limitar valores dentro de la escala
    const lVal = Math.max(20, Math.min(lowerLimit, 20000));
    const uVal = Math.max(20, Math.min(upperLimit, 20000));

    const pctLower = ((Math.log10(lVal) - logMin) / (logMax - logMin)) * 100;
    const pctUpper = ((Math.log10(uVal) - logMin) / (logMax - logMin)) * 100;
    const width = Math.max(5, pctUpper - pctLower); // Mínimo de ancho visual
    
    userSpectrumBar.style.left = `${pctLower}%`;
    userSpectrumBar.style.width = `${width}%`;
    userTrackLabel.textContent = `Tu espectro audible: ${lowerLimit.toFixed(0)} Hz - ${upperLimit.toFixed(0)} Hz`;

    // Texto explicativo e interpretativo
    const octavas = Math.log2(upperLimit / lowerLimit).toFixed(1);
    let analysisHTML = `Tu rango de audición abarca <strong>${octavas} octavas</strong> del espectro auditivo total.<br><br>`;
    
    if (upperLimit < 12000) {
        analysisHTML += `Es completamente normal perder sensibilidad en frecuencias altas (agudos) con el paso del tiempo o la exposición prolongada al ruido. Si eres joven, esto puede deberse a la respuesta de tus auriculares (muchos modelos domésticos reducen los agudos en los extremos) o a ruido de fondo en la habitación durante el test.`;
    } else {
        analysisHTML += `Los resultados muestran un umbral de agudos saludable. Conservas la capacidad de percibir sonidos de alta frecuencia en el rango típico de la juventud y la adultez temprana. Asegúrate de proteger tus oídos de ruidos fuertes para mantener este umbral auditivo en el futuro.`;
    }
    
    resultsAnalysisText.innerHTML = analysisHTML;
}

// Handler para clics en el gran botón interactivo central
function handleTriggerAction() {
    if (testState === 'phase1_running') {
        // Registrar límite inferior
        lowerLimit = currentFreq;
        setPhase1PausedState();
    } else if (testState === 'phase1_done') {
        // Continuar a la segunda fase
        startPhase2State();
    } else if (testState === 'phase2_running') {
        // Registrar límite superior y finalizar
        upperLimit = currentFreq;
        finishTest();
    }
}

// Bucle principal de actualización de frecuencia
function runSweepLoop() {
    if (testState !== 'phase1_running' && testState !== 'phase2_running') return;

    const now = performance.now();
    const dt = now - lastTime;
    lastTime = now;

    // Sumar el tiempo transcurrido
    accumulatedElapsedTime += dt;
    const totalDurationMs = duration * 1000;
    let elapsedFraction = accumulatedElapsedTime / totalDurationMs;

    if (elapsedFraction >= 1) {
        elapsedFraction = 1;
        currentFreq = maxFreq;
        
        // Si termina el tiempo:
        if (testState === 'phase1_running') {
            // El alumno nunca pulsó que empezó a oír, lo ponemos en el mínimo
            lowerLimit = minFreq;
            setPhase1PausedState();
            return;
        } else if (testState === 'phase2_running') {
            // El alumno nunca pulsó que dejó de oír, lo ponemos en el máximo
            upperLimit = maxFreq;
            finishTest();
            return;
        }
    } else {
        // Fórmula de barrido exponencial para repartir las octavas uniformemente en el tiempo
        const ratio = maxFreq / minFreq;
        currentFreq = minFreq * Math.pow(ratio, elapsedFraction);
    }

    // Actualizar frecuencia en el oscilador
    if (oscillator && audioCtx) {
        oscillator.frequency.setValueAtTime(currentFreq, audioCtx.currentTime);
    }

    // Actualizar interfaz
    freqDisplay.innerHTML = `${currentFreq.toFixed(1)} <span class="hz-label">Hz</span>`;
    progressBarFill.style.width = `${elapsedFraction * 100}%`;

    // Siguiente frame
    sweepAnimationId = requestAnimationFrame(runSweepLoop);
}

function abortTest() {
    stopOscillator();
    cancelAnimationFrame(sweepAnimationId);
    resetToSetup();
}

function resetToSetup() {
    testState = 'setup';
    setupPanel.classList.remove('hidden');
    testPanel.classList.add('hidden');
    resultsPanel.classList.add('hidden');
    
    // Restaurar barra de progreso
    progressBarFill.style.width = '0%';
    freqDisplay.innerHTML = `20.0 <span class="hz-label">Hz</span>`;
}

function copyResultsToClipboard() {
    const text = `Resultados del Test de Audición (Audímetro):
Límite Audible Inferior: ${lowerLimit.toFixed(0)} Hz
Límite Audible Superior: ${upperLimit.toFixed(0)} Hz
Espectro de Audición: ${Math.log2(upperLimit / lowerLimit).toFixed(1)} octavas.
Test realizado en: ${new Date().toLocaleDateString()}`;

    navigator.clipboard.writeText(text)
        .then(() => alert("Resultados copiados al portapapeles."))
        .catch(err => console.error("Error al copiar: ", err));
}


/* ==========================================================================
   CANVAS VISUALIZER (DIBUJO DE ONDAS EN TIEMPO REAL)
   ========================================================================== */

function setupCanvas() {
    const rect = waveCanvas.getBoundingClientRect();
    canvasWidth = rect.width;
    canvasHeight = rect.height;
    
    // Ajustar resolución de render para pantallas de alta densidad
    const dpr = window.devicePixelRatio || 1;
    waveCanvas.width = canvasWidth * dpr;
    waveCanvas.height = canvasHeight * dpr;
    
    canvasCtx = waveCanvas.getContext('2d');
    canvasCtx.scale(dpr, dpr);
}

function startVisualizer() {
    function draw() {
        visualizerAnimationId = requestAnimationFrame(draw);
        renderWave();
    }
    draw();
}

// Animación breve para el tono de prueba
let testToneAnimationFrames = 0;
function animateBriefWave() {
    testToneAnimationFrames = 60; // 1 segundo aprox a 60fps
}

function renderWave() {
    if (!canvasCtx) return;
    
    // Limpiar canvas
    canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Determinar amplitud visual basada en si hay sonido reproduciéndose
    let activeAmp = 0;
    if (isAudioRunning) {
        // Amplitud proporcional al volumen configurado
        activeAmp = currentVolume * (canvasHeight * 0.35);
    } else if (testToneAnimationFrames > 0) {
        // Amplitud para la prueba breve
        activeAmp = currentVolume * (canvasHeight * 0.35) * (testToneAnimationFrames / 60);
        testToneAnimationFrames--;
    }
    
    // Si no está sonando nada, mantenemos una onda casi plana de fondo sutil
    const baseAmp = activeAmp > 0 ? activeAmp : 1.5;
    
    // Ajustar la frecuencia visual de la onda según el Hz actual
    // Usamos escala logarítmica para que el visualizador sea armónico en todas las frecuencias
    let freqFactor = 1.0;
    if (isAudioRunning) {
        const logCurrent = Math.log10(currentFreq);
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        
        // Convertimos a un ratio de 0 a 1 y escalamos
        const freqRatio = (logCurrent - logMin) / (logMax - logMin);
        freqFactor = 1.0 + (freqRatio * 14.0); // De 1 a 15 ciclos visuales
    } else {
        // Frecuencia pasiva (onda lenta)
        freqFactor = 2.0;
    }

    // Dibujar múltiples capas de ondas (efecto Siri/seda moderna)
    drawSineWave(baseAmp, freqFactor, 0.4, 0);
    drawSineWave(baseAmp * 0.7, freqFactor * 1.3, 0.25, 1.2);
    drawSineWave(baseAmp * 0.4, freqFactor * 0.8, 0.15, 2.5);

    // Incrementar fase de la onda para el movimiento
    // La velocidad del movimiento de la onda aumenta sutilmente con la frecuencia física
    const waveSpeed = isAudioRunning ? 0.05 + ((currentFreq / maxFreq) * 0.08) : 0.03;
    wavePhase += waveSpeed;
}

function drawSineWave(amplitude, cycles, opacity, phaseOffset) {
    canvasCtx.save();
    canvasCtx.beginPath();
    
    // Gradiente de color según la fase de test
    let strokeColor;
    if (testState === 'phase1_running') {
        // Verde esmeralda con opacidad
        strokeColor = `rgba(16, 185, 129, ${opacity})`;
    } else if (testState === 'phase2_running') {
        // Rojo/rosa con opacidad
        strokeColor = `rgba(244, 63, 94, ${opacity})`;
    } else {
        // Azul cyan por defecto/inicial
        strokeColor = `rgba(6, 182, 212, ${opacity})`;
    }
    
    canvasCtx.strokeStyle = strokeColor;
    canvasCtx.lineWidth = opacity * 6; // Capas más opacas son más anchas
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';

    const halfHeight = canvasHeight / 2;
    
    for (let x = 0; x < canvasWidth; x++) {
        // Calcular la coordenada y usando la función seno
        const angle = (x / canvasWidth) * Math.PI * 2 * cycles;
        const y = halfHeight + Math.sin(angle + wavePhase + phaseOffset) * amplitude;
        
        if (x === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
    }
    
    canvasCtx.stroke();
    canvasCtx.restore();
}
