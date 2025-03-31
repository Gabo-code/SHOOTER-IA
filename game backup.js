const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const gameOverElement = document.getElementById('game-over');
const finalScoreElement = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');
const pausedElement = document.getElementById('paused'); // Elemento para pausa
const gameContainer = document.getElementById('game-container');

// --- Configuración del Juego ---
let canvasWidth = 800;
let canvasHeight = 600;
canvas.width = canvasWidth;
canvas.height = canvasHeight;
gameContainer.style.width = `${canvasWidth}px`;
gameContainer.style.height = `${canvasHeight}px`;

let player, bullets, zombies, score, mousePos, gameRunning, isPaused; // Añadido isPaused
let zombieSpawnInterval = 1500;
let lastZombieSpawnTime = 0;
let keysPressed = {};
let animationId;

// --- Audio ---
let audioContext;
let shootBuffer;
let zombieBuffer;
const MAX_ZOMBIE_VOLUME = 0.3; // Volumen máximo para un solo zombie (evita saturación)
const MAX_HEARING_DISTANCE = 400; // Distancia máxima a la que se oye un zombie
const MIN_DISTANCE_FOR_MAX_VOL = 50; // Distancia para volumen máximo

// Intenta inicializar AudioContext (requiere interacción del usuario en algunos navegadores)
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        loadSounds();
    } catch (e) {
        console.error("Web Audio API no es soportada en este navegador.", e);
    }
}

// Carga los archivos de sonido
async function loadSound(url) {
    if (!audioContext) return null;
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        return audioBuffer;
    } catch (error) {
        console.error(`Error cargando el sonido: ${url}`, error);
        return null;
    }
}

async function loadSounds() {
    shootBuffer = await loadSound('shoot.mp3'); // Cambia la extensión si usas .mp3 u .ogg
    zombieBuffer = await loadSound('zombie.mp3'); // Cambia la extensión si usas .mp3 u .ogg
    console.log("Sonidos cargados (si no hay errores previos).");
}

// Función para reproducir un buffer de sonido
function playSound(buffer, volume = 1.0, loop = false) {
    if (!audioContext || !buffer || audioContext.state === 'suspended') return null; // No reproducir si está pausado o no cargado

    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain(); // Nodo para controlar el volumen

    source.buffer = buffer;
    source.loop = loop;
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime); // Establecer volumen

    source.connect(gainNode);          // Conectar fuente al nodo de ganancia
    gainNode.connect(audioContext.destination); // Conectar ganancia a la salida (altavoces)
    source.start(0);
    return { source, gainNode }; // Devolver referencias para control futuro (ej: zombies)
}

// Asegurarse que el AudioContext se reanude con la interacción del usuario
function resumeAudioContext() {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log("AudioContext reanudado.");
        });
    }
}
// Añadir listeners para reanudar el contexto en la primera interacción
document.body.addEventListener('click', resumeAudioContext, { once: true });
document.body.addEventListener('keydown', resumeAudioContext, { once: true });


// --- Clases y Objetos del Juego ---

class Player {
    constructor(x, y, radius, color, speed) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.speed = speed;
        this.angle = 0;
    }

    draw() {
        // Cuerpo
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Mira
        const barrelLength = this.radius * 1.5;
        const barrelEndX = this.x + barrelLength * Math.cos(this.angle);
        const barrelEndY = this.y + barrelLength * Math.sin(this.angle);
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(barrelEndX, barrelEndY);
        ctx.stroke();
        ctx.lineWidth = 1;
    }

    update() {
        this.angle = Math.atan2(mousePos.y - this.y, mousePos.x - this.x);
        let moveX = 0;
        let moveY = 0;
        if (keysPressed['w'] || keysPressed['W'] || keysPressed['ArrowUp']) moveY -= 1;
        if (keysPressed['s'] || keysPressed['S'] || keysPressed['ArrowDown']) moveY += 1;
        if (keysPressed['a'] || keysPressed['A'] || keysPressed['ArrowLeft']) moveX -= 1;
        if (keysPressed['d'] || keysPressed['D'] || keysPressed['ArrowRight']) moveX += 1;

        const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
        if (magnitude > 0) {
            moveX = (moveX / magnitude) * this.speed;
            moveY = (moveY / magnitude) * this.speed;
        }
        this.x += moveX;
        this.y += moveY;
        this.x = Math.max(this.radius, Math.min(canvas.width - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(canvas.height - this.radius, this.y));
        this.draw();
    }
}

class Bullet {
    constructor(x, y, radius, color, velocity) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.velocity = velocity;
    }
    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
    update() {
        this.x += this.velocity.x;
        this.y += this.velocity.y;
        this.draw();
    }
}

class Zombie {
    constructor(x, y, radius, color, speed) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.speed = speed;
        this.audioSource = null; // Referencia a su fuente de sonido
        this.gainNode = null;    // Referencia a su nodo de ganancia

        // Iniciar sonido de zombie en bucle (si el buffer está listo)
        if (zombieBuffer && audioContext && audioContext.state !== 'suspended') {
            const audioNodes = playSound(zombieBuffer, 0, true); // Inicia con volumen 0
            if (audioNodes) {
                 this.audioSource = audioNodes.source;
                 this.gainNode = audioNodes.gainNode;
            }
        }
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    update(target) {
        const angle = Math.atan2(target.y - this.y, target.x - this.x);
        this.x += Math.cos(angle) * this.speed;
        this.y += Math.sin(angle) * this.speed;

        // Actualizar volumen del sonido basado en la distancia
        if (this.gainNode && audioContext && audioContext.state !== 'suspended') {
            const dist = Math.hypot(target.x - this.x, target.y - this.y);
            let volume = 0;

            if (dist < MAX_HEARING_DISTANCE) {
                // Mapeo lineal inverso de distancia a volumen
                volume = MAX_ZOMBIE_VOLUME * (1 - Math.max(0, dist - MIN_DISTANCE_FOR_MAX_VOL) / (MAX_HEARING_DISTANCE - MIN_DISTANCE_FOR_MAX_VOL));
                volume = Math.max(0, Math.min(MAX_ZOMBIE_VOLUME, volume)); // Asegurar que esté entre 0 y MAX_ZOMBIE_VOLUME
            }

            // Ajustar volumen suavemente para evitar clics
            this.gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.1); // Rampa suave en 0.1s
        }

        this.draw();
    }

    // Método para detener el sonido cuando el zombie muere
    stopSound() {
         if (this.audioSource) {
            try {
                 this.audioSource.stop();
                 this.audioSource.disconnect(); // Desconectar nodos
                 this.gainNode.disconnect();
             } catch(e) {
                 // Puede dar error si ya se detuvo o desconectó, es seguro ignorarlo en este caso
                 // console.warn("Intento de detener sonido ya detenido:", e);
             }
        }
    }
}

// --- Funciones del Juego ---

function init() {
    // Inicializar Audio si no se ha hecho ya
    if (!audioContext) {
        initAudio();
    }

    player = new Player(canvas.width / 2, canvas.height / 2, 15, 'blue', 3);
    bullets = [];
    // Limpiar sonidos de zombies anteriores antes de vaciar el array
    if (zombies) {
        zombies.forEach(zombie => zombie.stopSound());
    }
    zombies = [];
    score = 0;
    mousePos = { x: canvas.width / 2, y: canvas.height / 2 }; // Centrar ratón inicial
    gameRunning = true;
    isPaused = false; // Asegurarse que no empieza pausado
    lastZombieSpawnTime = performance.now(); // Usar performance.now() para mayor precisión
    zombieSpawnInterval = 1500;
    scoreElement.textContent = score;
    gameOverElement.style.display = 'none';
    pausedElement.style.display = 'none'; // Ocultar pausa
    keysPressed = {};
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
    gameLoop(performance.now()); // Iniciar nuevo bucle con timestamp inicial
}

function spawnZombie() {
    const radius = Math.random() * 10 + 10;
    const speed = Math.random() * 1 + 0.5;
    const color = 'green';
    let x, y;
    if (Math.random() < 0.5) {
        x = Math.random() * canvas.width;
        y = Math.random() < 0.5 ? 0 - radius : canvas.height + radius;
    } else {
        x = Math.random() < 0.5 ? 0 - radius : canvas.width + radius;
        y = Math.random() * canvas.height;
    }
    zombies.push(new Zombie(x, y, radius, color, speed));
}

function handleCollisions() {
    // Bala - Zombie
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        for (let j = zombies.length - 1; j >= 0; j--) {
            if (!bullets[i]) break; // Si la bala fue eliminada por otro zombie en el mismo frame
            const zombie = zombies[j];
            const dist = Math.hypot(bullet.x - zombie.x, bullet.y - zombie.y);

            if (dist - zombie.radius - bullet.radius < 1) {
                zombie.stopSound(); // Detener sonido del zombie eliminado
                score += 10;
                scoreElement.textContent = score;
                bullets.splice(i, 1);
                zombies.splice(j, 1);
                zombieSpawnInterval = Math.max(300, zombieSpawnInterval * 0.99);
                break; // Salir bucle interno, bala eliminada
            }
        }
    }

    // Jugador - Zombie
    for (let j = zombies.length - 1; j >= 0; j--) {
        const zombie = zombies[j];
        const dist = Math.hypot(player.x - zombie.x, player.y - zombie.y);

        if (dist - zombie.radius - player.radius < 1) {
            gameOver();
            break;
        }
    }
}

function gameOver() {
    gameRunning = false;
    finalScoreElement.textContent = score;
    gameOverElement.style.display = 'flex';
    // Detener todos los sonidos de zombies restantes
    zombies.forEach(zombie => zombie.stopSound());
    cancelAnimationFrame(animationId);
}

function togglePause() {
    isPaused = !isPaused;
    pausedElement.style.display = isPaused ? 'flex' : 'none';

    // Pausar/Reanudar el contexto de audio globalmente
    if (audioContext) {
        if (isPaused && audioContext.state === 'running') {
            audioContext.suspend().then(() => console.log("AudioContext suspendido."));
        } else if (!isPaused && audioContext.state === 'suspended') {
            audioContext.resume().then(() => console.log("AudioContext reanudado (pausa)."));
        }
    }

    // Si se despausa, continuar el bucle del juego
    if (!isPaused && gameRunning) {
        // Necesitamos reiniciar el timestamp para el spawn de zombies
        // para evitar un spawn masivo justo después de despausar
        lastZombieSpawnTime = performance.now();
        gameLoop(performance.now()); // Llama de nuevo para continuar la animación
    }
}

function drawPauseScreen() {
    // El div #paused ya se muestra/oculta en togglePause()
    // Podríamos añadir un overlay semitransparente si quisiéramos
    // ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    // ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// --- Bucle Principal del Juego ---
function gameLoop(timestamp) { // timestamp es ahora de performance.now()
    // Solicitar el siguiente frame ANTES de hacer nada más
    // para mantener el bucle incluso si está pausado o termina
    animationId = requestAnimationFrame(gameLoop);

    if (!gameRunning) return; // Detener si es Game Over

    if (isPaused) {
        drawPauseScreen(); // Dibujar pantalla de pausa si es necesario
        return; // No actualizar ni dibujar el juego si está pausado
    }

    // Limpiar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Actualizar y dibujar jugador
    player.update();

    // Spawnea zombies periódicamente
    if (timestamp - lastZombieSpawnTime > zombieSpawnInterval) {
        spawnZombie();
        lastZombieSpawnTime = timestamp;
    }

    // Actualizar y dibujar zombies
    zombies.forEach(zombie => {
        zombie.update(player);
    });

    // Actualizar y dibujar balas
    bullets.forEach((bullet, index) => {
        bullet.update();
        if (bullet.x + bullet.radius < 0 ||
            bullet.x - bullet.radius > canvas.width ||
            bullet.y + bullet.radius < 0 ||
            bullet.y - bullet.radius > canvas.height) {
            // Usar setTimeout para eliminar la bala en el siguiente ciclo,
            // evita problemas si se modifica el array mientras se itera
            setTimeout(() => bullets.splice(index, 1), 0);
        }
    });

    // Comprobar colisiones
    handleCollisions();
}

// --- Event Listeners ---

// Movimiento
window.addEventListener('keydown', (e) => {
    // Pausar/Despausar con Escape
    if (e.key === 'Escape') {
        if (gameRunning) { // Solo pausar si el juego no ha terminado
             togglePause();
        }
        return; // No procesar otras teclas si se presionó Escape
    }

     if (!isPaused) { // Solo procesar movimiento si no está pausado
         keysPressed[e.key] = true;
         resumeAudioContext(); // Asegurar que el audio funciona al presionar tecla
     }
});

window.addEventListener('keyup', (e) => {
    // No es necesario comprobar la pausa aquí, simplemente registra que la tecla se soltó
    keysPressed[e.key] = false;
});

// Disparar
canvas.addEventListener('click', (event) => {
    resumeAudioContext(); // Asegurar que el audio funciona al hacer click
    if (!gameRunning || isPaused) return; // No disparar si game over o pausado

    playSound(shootBuffer, 0.4); // Reproducir sonido de disparo con volumen reducido

    const angle = Math.atan2(mousePos.y - player.y, mousePos.x - player.x);
    const bulletSpeed = 5;
    const velocity = {
        x: Math.cos(angle) * bulletSpeed,
        y: Math.sin(angle) * bulletSpeed
    };
    bullets.push(new Bullet(player.x, player.y, 5, 'yellow', velocity));
});

// Rastrear ratón
canvas.addEventListener('mousemove', (event) => {
    // No es necesario comprobar pausa aquí, apuntar funciona siempre
    const rect = canvas.getBoundingClientRect();
    mousePos = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
});

// Botón Reiniciar
restartButton.addEventListener('click', () => {
    init();
});

// --- Iniciar el juego ---
init(); // Llama a init que ahora también inicializa el audio