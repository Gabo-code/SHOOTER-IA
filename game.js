// --- Elementos del DOM ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const gameOverElement = document.getElementById('game-over');
const finalScoreElement = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');
const pausedElement = document.getElementById('paused');
const gameContainer = document.getElementById('game-container');
const personalBestElement = document.getElementById('personal-best');


// --- Configuración del Juego ---
let canvasWidth = 800;
let canvasHeight = 600;
canvas.width = canvasWidth;
canvas.height = canvasHeight;
gameContainer.style.width = `${canvasWidth}px`;
gameContainer.style.height = `${canvasHeight}px`;

// --- Variables Globales del Juego ---
let player, bullets, zombies, score, mousePos, gameRunning, isPaused;
let zombieSpawnInterval = 1500;
let lastZombieSpawnTime = 0;
let keysPressed = {};
let animationId;

// --- Missile Powerup ---
let missileItem = {
    x: 0,
    y: 0,
    radius: 12,
    color: 'orange',
    active: false, // Is it currently on the map?
    spawnInterval: 60000, // 1 minute in milliseconds
    lastSpawnTime: 0
};

//PB
const LOCAL_STORAGE_PB_KEY = 'zombieShooterPersonalBest';

// --- Audio ---
let audioContext; // <<<--- DECLARACIÓN GLOBAL IMPORTANTE
let shootBuffer = null;
let zombieBuffer = null;
let deathSoundBuffer = null; // <<<--- NUEVO: Buffer para sonido de muerte
let missilePickupSoundBuffer = null; // <<<--- NUEVO: Buffer para sonido de recoger misil
const MAX_ZOMBIE_VOLUME = 0.3;
const MAX_HEARING_DISTANCE = 400;
const MIN_DISTANCE_FOR_MAX_VOL = 50;

// --- Obstáculos ---
let obstacles = []; // Array para guardar vallas y arbustos
const FENCE_COLOR = '#8B4513'; // Marrón silla de montar (SaddleBrown)
const BUSH_COLOR = '#228B22'; // Verde bosque (ForestGreen)
const BUSH_ALPHA = 0.3; // Opacidad de zombies en arbustos (30%)


// --- Funciones de Audio ---
function initAudio() {
    try {
        console.log("Intentando inicializar AudioContext...");
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log("AudioContext creado. Estado inicial:", audioContext.state);
        loadSounds();
    } catch (e) {
        console.error("Web Audio API no es soportada o falló la inicialización.", e);
        alert("Tu navegador no soporta audio o hubo un error. El juego funcionará sin sonido.");
    }
}

async function loadSound(url) {
    if (!audioContext) return null;
    console.log(`Intentando cargar sonido: ${url}`);
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status} para ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log(`Sonido cargado y decodificado: ${url}`);
        return audioBuffer;
    } catch (error) {
        console.error(`Error cargando o decodificando el sonido: ${url}`, error);
        // No mostrar alert aquí para no interrumpir por cada sonido, solo loguear
        console.warn(`No se pudo cargar el sonido ${url}. Revisa la ruta y el archivo.`);
        return null;
    }
}

async function loadSounds() {
    try {
        // Carga todos los sonidos en paralelo
        [shootBuffer, zombieBuffer, deathSoundBuffer, missilePickupSoundBuffer] = await Promise.all([
            loadSound('shoot.mp3'),
            loadSound('zombie.mp3'),
            loadSound('jijjea.mp3'),      // <<<--- NUEVO: Cargar sonido de muerte
            loadSound('byebye.mp3')       // <<<--- NUEVO: Cargar sonido de recoger misil
        ]);
        console.log("Proceso de carga de sonidos finalizado.");
        if (!shootBuffer) console.warn("Buffer de disparo NO cargado.");
        if (!zombieBuffer) console.warn("Buffer de zombie NO cargado.");
        if (!deathSoundBuffer) console.warn("Buffer de muerte (jijjea.mp3) NO cargado.");
        if (!missilePickupSoundBuffer) console.warn("Buffer de recoger misil (byebye.mp3) NO cargado.");
    } catch (error) {
        console.error("Error durante la carga paralela de sonidos:", error);
    }
}


function playSound(buffer, volume = 1.0, loop = false) {
    if (!audioContext || !buffer) {
        // console.warn("Intento de reproducir sonido fallido: AudioContext no listo o buffer nulo.");
        return null;
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            // console.log("AudioContext reanudado por playSound.");
            playSoundInternal(buffer, volume, loop);
        }).catch(e => console.error("Error al reanudar AudioContext:", e));
        return null; // Aún no se puede reproducir inmediatamente
    } else if (audioContext.state === 'running') {
        return playSoundInternal(buffer, volume, loop);
    } else {
        // console.warn(`AudioContext en estado inesperado: ${audioContext.state}`);
        return null;
    }
}

function playSoundInternal(buffer, volume, loop) {
    try {
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        source.buffer = buffer;
        source.loop = loop;
        // Usar linearRamp para evitar clicks, con fallback a setValueAtTime
        try {
             gainNode.gain.setValueAtTime(volume, audioContext.currentTime); // Valor inicial inmediato
        } catch(e){ console.warn("Error con setValueAtTime:", e)}

        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        source.start(0);
        // console.log("Sonido reproducido."); // Log opcional
        return { source, gainNode };
    } catch (e) {
        console.error("Error al reproducir sonido internamente:", e);
        return null;
    }
}


function resumeAudioContextOnClick() {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => console.log("AudioContext reanudado por click."))
                       .catch(e => console.error("Error reanudando AudioContext por click:", e));
    }
    // No necesitamos remover los listeners si usamos { once: true }
}
function resumeAudioContextOnKey() {
     if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => console.log("AudioContext reanudado por tecla."))
                       .catch(e => console.error("Error reanudando AudioContext por tecla:", e));
    }
     // No necesitamos remover los listeners si usamos { once: true }
}
// Usar { once: true } para que se ejecuten solo la primera vez
document.body.addEventListener('click', resumeAudioContextOnClick, { once: true });
document.body.addEventListener('keydown', resumeAudioContextOnKey, { once: true });


// --- Funciones de Ayuda para Colisiones y Obstáculos ---
function checkRectCollision(rect1, rect2) {
    // ... (sin cambios)
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
}

function checkEntityFenceCollision(entity, nextX, nextY) {
    // Considerar el radio de la entidad para la colisión
    const entityRadius = entity.radius || 0; // Usar 0 si no tiene radio (p.ej. al spawnear missile)
    const entityRect = { // Bounding box futuro de la entidad
        x: nextX - entityRadius,
        y: nextY - entityRadius,
        width: entityRadius * 2,
        height: entityRadius * 2,
    };

    for (const obstacle of obstacles) {
        if (obstacle.type === 'fence') {
            // Crear el rect del obstáculo valla
            const fenceRect = {
                x: obstacle.x,
                y: obstacle.y,
                width: obstacle.width,
                height: obstacle.height
            };
            if (checkRectCollision(entityRect, fenceRect)) {
                return true; // Colisión con valla
            }
        }
    }
    return false; // Sin colisión con vallas
}


function isEntityInBush(entity) {
    // ... (sin cambios)
    const entityPoint = { x: entity.x, y: entity.y, width: 1, height: 1 }; // Usar punto central
    for (const obstacle of obstacles) {
        if (obstacle.type === 'bush') {
            if (checkRectCollision(entityPoint, obstacle)) {
                return true; // Centro en arbusto
            }
        }
    }
    return false; // No en arbusto
}

function checkBulletFenceCollision(bullet) {
    // ... (sin cambios)
    const bulletRadius = bullet.radius;
    // Bounding box actual de la bala
    const bulletRect = {
        x: bullet.x - bulletRadius,
        y: bullet.y - bulletRadius,
        width: bulletRadius * 2,
        height: bulletRadius * 2,
    };

    for (const obstacle of obstacles) {
        if (obstacle.type === 'fence') {
            if (checkRectCollision(bulletRect, obstacle)) {
                return true; // Colisión con valla
            }
        }
    }
    return false; // Sin colisión con vallas
}

//PB
// --- Función para cargar y mostrar el PB al inicio ---
function loadAndDisplayPersonalBest() {
    // ... (sin cambios)
    const savedPB = localStorage.getItem(LOCAL_STORAGE_PB_KEY);
    const currentPB = parseInt(savedPB, 10) || 0;
    personalBestElement.textContent = currentPB;
    console.log('PB cargado:', currentPB);
    return currentPB;
}

// --- Función para comprobar y guardar un nuevo PB ---
function checkAndSavePersonalBest(currentScore) {
    // ... (sin cambios)
    const savedPB = localStorage.getItem(LOCAL_STORAGE_PB_KEY);
    const currentBestScore = parseInt(savedPB, 10) || 0;

    if (currentScore > currentBestScore) {
        console.log(`¡Nuevo PB! ${currentScore} > ${currentBestScore}. Guardando...`);
        localStorage.setItem(LOCAL_STORAGE_PB_KEY, currentScore);
        personalBestElement.textContent = currentScore;
        return true;
    } else {
        // console.log(`Puntuación (${currentScore}) no superó el PB (${currentBestScore}).`);
        return false;
    }
}

// --- Clases del Juego ---
class Player {
    // ... (sin cambios en constructor y draw)
    constructor(x, y, radius, color, speed) {
        this.x = x; this.y = y; this.radius = radius; this.color = color; this.speed = speed; this.angle = 0;
    }

    draw() {
        // Cuerpo
        ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
        // Mira
        const barrelLength = this.radius * 1.5; const barrelEndX = this.x + barrelLength * Math.cos(this.angle); const barrelEndY = this.y + barrelLength * Math.sin(this.angle);
        ctx.strokeStyle = 'black'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(barrelEndX, barrelEndY); ctx.stroke(); ctx.lineWidth = 1;
    }

    update() {
        this.angle = Math.atan2(mousePos.y - this.y, mousePos.x - this.x);
        let moveX = 0; let moveY = 0;
        if (keysPressed['w'] || keysPressed['W'] || keysPressed['ArrowUp']) moveY -= 1; if (keysPressed['s'] || keysPressed['S'] || keysPressed['ArrowDown']) moveY += 1;
        if (keysPressed['a'] || keysPressed['A'] || keysPressed['ArrowLeft']) moveX -= 1; if (keysPressed['d'] || keysPressed['D'] || keysPressed['ArrowRight']) moveX += 1;

        const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
        let deltaX = 0; let deltaY = 0;
        if (magnitude > 0) {
            deltaX = (moveX / magnitude) * this.speed;
            deltaY = (moveY / magnitude) * this.speed;
        }

        let targetX = this.x + deltaX;
        let targetY = this.y + deltaY;

        // Usar checkEntityFenceCollision con el objeto player (this)
        // Comprobar colisión X
        if (checkEntityFenceCollision(this, targetX, this.y)) {
            targetX = this.x; // No mover en X si choca
        }
        // Comprobar colisión Y usando la X ya validada
        if (checkEntityFenceCollision(this, targetX, targetY)) {
            targetY = this.y; // No mover en Y si choca
        }
        // Re-comprobar X por si el ajuste de Y causó colisión en X (diagonal contra esquina)
        if (targetX !== this.x && checkEntityFenceCollision(this, targetX, targetY)) {
             targetX = this.x;
        }

        this.x = targetX;
        this.y = targetY;

        // Mantener dentro del canvas (después de colisiones con vallas)
        this.x = Math.max(this.radius, Math.min(canvas.width - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(canvas.height - this.radius, this.y));

        this.draw();
    }
}

class Bullet {
    // ... (sin cambios)
    constructor(x, y, radius, color, velocity) {
        this.x = x; this.y = y; this.radius = radius; this.color = color; this.velocity = velocity;
    }
    draw() {
        ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
    }
    update() {
        this.x += this.velocity.x; this.y += this.velocity.y; this.draw();
    }
}

class Zombie {
    // ... (sin cambios en constructor, draw, stopSound)
    constructor(x, y, radius, color, speed) {
        this.x = x; this.y = y; this.radius = radius; this.color = color; this.speed = speed;
        this.audioSource = null; this.gainNode = null;
        this.targetAngle = 0;
        this.angleUpdateInterval = 300 + Math.random() * 200;
        this.lastAngleUpdateTime = 0;
        this.maxAngleDeviation = Math.PI / 12;
        this.moveChance = 0.98;
    }

    draw() {
        const inBush = isEntityInBush(this);
        const originalAlpha = ctx.globalAlpha;
        ctx.globalAlpha = inBush ? BUSH_ALPHA : 1.0;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = originalAlpha;
    }

    update(target, timestamp) {
        if (Math.random() > this.moveChance) {
            this.draw();
            return;
        }

        if (timestamp - this.lastAngleUpdateTime > this.angleUpdateInterval) {
            const directAngle = Math.atan2(target.y - this.y, target.x - this.x);
            const randomOffset = (Math.random() * 2 - 1) * this.maxAngleDeviation;
            this.targetAngle = directAngle + randomOffset;
            this.lastAngleUpdateTime = timestamp;
        }

        const deltaX = Math.cos(this.targetAngle) * this.speed;
        const deltaY = Math.sin(this.targetAngle) * this.speed;

        let targetX = this.x + deltaX;
        let targetY = this.y + deltaY;

        // Usar checkEntityFenceCollision con el objeto zombie (this)
        if (checkEntityFenceCollision(this, targetX, this.y)) targetX = this.x;
        if (checkEntityFenceCollision(this, targetX, targetY)) targetY = this.y;
        if (targetX !== this.x && checkEntityFenceCollision(this, targetX, targetY)) targetX = this.x;

        this.x = targetX;
        this.y = targetY;

        if (this.gainNode && audioContext && audioContext.state === 'running') {
            const dist = Math.hypot(target.x - this.x, target.y - this.y);
            let volume = 0;
            if (dist < MAX_HEARING_DISTANCE) {
                volume = MAX_ZOMBIE_VOLUME * (1 - Math.max(0, dist - MIN_DISTANCE_FOR_MAX_VOL) / (MAX_HEARING_DISTANCE - MIN_DISTANCE_FOR_MAX_VOL));
                volume = Math.max(0, Math.min(MAX_ZOMBIE_VOLUME, volume));
            }
            try { this.gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.1); }
            catch (e) { this.gainNode.gain.setValueAtTime(volume, audioContext.currentTime); }
        }

        this.draw();
    }

    stopSound() {
         if (this.audioSource) {
            try {
                 this.audioSource.stop(); this.audioSource.disconnect();
                 if (this.gainNode) this.gainNode.disconnect();
             } catch(e) {/* Ignorar */}
             this.audioSource = null; this.gainNode = null;
        }
    }
}

// --- Funciones del Juego ---
function drawObstacles() {
    // ... (sin cambios)
    obstacles.forEach(obstacle => {
        ctx.fillStyle = obstacle.color;
        // Dibujar arbustos primero para que estén detrás de las vallas si se solapan
        if (obstacle.type === 'bush') {
            ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    });
    obstacles.forEach(obstacle => {
        // Dibujar vallas después
        if (obstacle.type === 'fence') {
            ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        }
    });
}

function createObstacles() {
    obstacles = []; // Limpiar

    // Vallas
    obstacles.push({ type: 'fence', x: 100, y: 150, width: 150, height: 20, color: FENCE_COLOR });
    obstacles.push({ type: 'fence', x: canvasWidth - 250, y: canvasHeight - 170, width: 150, height: 20, color: FENCE_COLOR });
    obstacles.push({ type: 'fence', x: canvasWidth / 2 - 10, y: 50, width: 20, height: 100, color: FENCE_COLOR });
    obstacles.push({ type: 'fence', x: canvasWidth / 2 - 10, y: canvasHeight - 150, width: 20, height: 100, color: FENCE_COLOR });
    obstacles.push({ type: 'fence', x: 200, y: canvasHeight / 2 - 10, width: 100, height: 20, color: FENCE_COLOR });

    // Arbustos
    obstacles.push({ type: 'bush', x: 200, y: canvasHeight - 100, width: 100, height: 80, color: BUSH_COLOR });
    obstacles.push({ type: 'bush', x: canvasWidth - 300, y: 80, width: 120, height: 60, color: BUSH_COLOR });
    obstacles.push({ type: 'bush', x: 50, y: canvasHeight / 2 - 40, width: 80, height: 80, color: BUSH_COLOR });
    obstacles.push({ type: 'bush', x: canvasWidth - 150, y: canvasHeight / 2 - 50, width: 100, height: 100, color: BUSH_COLOR });

    console.log("Obstáculos creados:", obstacles.length);
}

// --- NUEVO: Función para dibujar el misil ---
function drawMissile() {
    if (!missileItem.active) return; // No dibujar si no está activo

    ctx.fillStyle = missileItem.color;
    ctx.strokeStyle = 'black'; // Borde para destacar
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(missileItem.x, missileItem.y, missileItem.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1; // Resetear grosor línea
}

// --- NUEVO: Función para intentar spawnear el misil ---
function trySpawnMissile(timestamp) {
    // Solo intentar si no hay un misil activo y ha pasado el tiempo
    if (!missileItem.active && (timestamp - missileItem.lastSpawnTime > missileItem.spawnInterval)) {
        let validSpawn = false;
        let attempts = 0;
        let spawnX, spawnY;

        while (!validSpawn && attempts < 50) { // Intentar hasta 50 veces
            attempts++;
            // Generar posición aleatoria dentro del canvas, con un margen
            spawnX = missileItem.radius + Math.random() * (canvasWidth - missileItem.radius * 2);
            spawnY = missileItem.radius + Math.random() * (canvasHeight - missileItem.radius * 2);

            // Comprobar que no spawnee DENTRO de una valla
            // Creamos un objeto temporal para la comprobación
            const tempMissile = { x: spawnX, y: spawnY, radius: missileItem.radius };
            if (!checkEntityFenceCollision(tempMissile, spawnX, spawnY)) {
                validSpawn = true;
            }
        }

        if (validSpawn) {
            missileItem.x = spawnX;
            missileItem.y = spawnY;
            missileItem.active = true;
            missileItem.lastSpawnTime = timestamp; // Resetear timer *solo* al spawnear
            console.log(`Misil spawneado en ${spawnX.toFixed(0)}, ${spawnY.toFixed(0)}`);
        } else {
            console.warn("No se pudo encontrar posición válida para el misil tras varios intentos.");
            // Resetear timer igualmente para no intentar spawnear en cada frame
            missileItem.lastSpawnTime = timestamp;
        }
    }
}


function init() {
    console.log("--- Iniciando Juego ---");
    if (!audioContext) {
        console.warn("AudioContext no inicializado, intentando de nuevo.");
        initAudio(); // Asegurar que se intenta inicializar audio
    } else if (audioContext.state === 'suspended') {
        // Si ya existe pero está suspendido (p.ej. tras game over), reanudarlo
        audioContext.resume().then(() => console.log("AudioContext reanudado en init."));
    }

    createObstacles(); // Crear obstáculos

    // Posición inicial jugador (validada)
    let validPlayerPos = false;
    let playerX = canvasWidth / 2;
    let playerY = canvasHeight / 2;
    let attempts = 0;
    while (!validPlayerPos && attempts < 10) {
        const tempPlayer = { x: playerX, y: playerY, radius: 15 };
        if (!checkEntityFenceCollision(tempPlayer, playerX, playerY)) {
            validPlayerPos = true;
        } else {
            playerX += 25 * (Math.random() < 0.5 ? 1 : -1); // Mover aleatoriamente
            playerY += 10 * (Math.random() < 0.5 ? 1 : -1);
             // Mantener dentro de límites aproximados para no irse muy lejos
            playerX = Math.max(15, Math.min(canvasWidth - 15, playerX));
            playerY = Math.max(15, Math.min(canvasHeight - 15, playerY));
            attempts++;
        }
    }
     if (!validPlayerPos) {
         console.error("NO SE PUDO COLOCAR AL JUGADOR FUERA DE VALLAS! Usando centro.");
         playerX = canvasWidth / 2; playerY = canvasHeight / 2;
     }

    player = new Player(playerX, playerY, 15, 'blue', 3);
    bullets = [];
    if (zombies && zombies.length > 0) {
        zombies.forEach(zombie => zombie.stopSound());
    }
    zombies = [];
    score = 0;
    mousePos = { x: canvas.width / 2, y: canvas.height / 2 };
    gameRunning = true;
    isPaused = false;
    lastZombieSpawnTime = performance.now();
    zombieSpawnInterval = 1500; // Resetear dificultad spawn
    scoreElement.textContent = score;
    gameOverElement.style.display = 'none';
    pausedElement.style.display = 'none';

    // Resetear estado del misil
    missileItem.active = false;
    missileItem.lastSpawnTime = performance.now(); // Iniciar timer para el primer misil

    loadAndDisplayPersonalBest();

    keysPressed = {};
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    console.log("Iniciando nuevo gameLoop...");
    animationId = requestAnimationFrame(gameLoop);
    console.log("--- Inicialización Completa ---");
}

function spawnZombie() {
    // ... (lógica de spawn de zombie sin cambios, solo se asegura de no spawnear en valla)
    const radius = Math.random() * 10 + 10;
    const speed = Math.random() * 1 + 0.5;
    const color = 'green';
    let x, y;
    let validSpawn = false;
    let attempts = 0;

    while (!validSpawn && attempts < 50) {
        attempts++;
        const spawnEdge = Math.random();
        if (spawnEdge < 0.25) { // Arriba
            x = Math.random() * canvas.width; y = 0 - radius;
        } else if (spawnEdge < 0.5) { // Abajo
            x = Math.random() * canvas.width; y = canvas.height + radius;
        } else if (spawnEdge < 0.75) { // Izquierda
            x = 0 - radius; y = Math.random() * canvas.height;
        } else { // Derecha
            x = canvas.width + radius; y = Math.random() * canvas.height;
        }

        // Comprobar si la posición inicial está dentro de una valla
        const tempZombie = { x: x, y: y, radius: radius };
        if (!checkEntityFenceCollision(tempZombie, x, y)) {
            validSpawn = true;
        }
    }


    if (validSpawn) {
        const newZombie = new Zombie(x, y, radius, color, speed);
        zombies.push(newZombie);

        if (zombieBuffer && audioContext && audioContext.state === 'running') {
            const audioNodes = playSoundInternal(zombieBuffer, 0, true); // Iniciar con volumen 0
            if (audioNodes) {
                newZombie.audioSource = audioNodes.source;
                newZombie.gainNode = audioNodes.gainNode;
                // La lógica de update ajustará el volumen basado en la distancia
            }
        }
    } else {
        // console.warn("No se pudo spawnear zombie fuera de vallas tras varios intentos.");
    }
}


function handleCollisions() {
    // Bala - Zombie
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        if (!bullet) continue; // Seguridad extra

        // Optimización: Comprobar si la bala está fuera de pantalla o chocó con valla
        if (checkBulletFenceCollision(bullet) ||
            bullet.x + bullet.radius < 0 || bullet.x - bullet.radius > canvas.width ||
            bullet.y + bullet.radius < 0 || bullet.y - bullet.radius > canvas.height)
        {
            bullets.splice(i, 1);
            continue; // Ir a la siguiente bala
        }


        for (let j = zombies.length - 1; j >= 0; j--) {
            const zombie = zombies[j];
             if (!zombie) continue; // Seguridad extra

            const dist = Math.hypot(bullet.x - zombie.x, bullet.y - zombie.y);
            if (dist - zombie.radius - bullet.radius < 1) {
                zombie.stopSound(); // Detener sonido del zombie específico
                score += 10;
                scoreElement.textContent = score;
                // Reducir intervalo de spawn ligeramente
                zombieSpawnInterval = Math.max(250, zombieSpawnInterval * 0.995); // Mínimo 250ms

                // Eliminar bala y zombie
                bullets.splice(i, 1);
                zombies.splice(j, 1);

                // Importante: Si la bala impactó, ya no puede impactar a otro zombie
                // Salir del bucle interno (j) e ir a la siguiente bala (o terminar si no hay más)
                break;
            }
        }
    }

    // Jugador - Zombie
    if (!gameRunning) return; // No comprobar si ya terminó
    for (let j = zombies.length - 1; j >= 0; j--) {
        const zombie = zombies[j];
        if (!zombie) continue;
        const dist = Math.hypot(player.x - zombie.x, player.y - zombie.y);
        if (dist - zombie.radius - player.radius < 1) {
            gameOver(); // Llama a la función que maneja el fin del juego
            return; // Salir de handleCollisions inmediatamente
        }
    }

    // --- NUEVO: Jugador - Misil ---
    if (missileItem.active) {
        const distPlayerMissile = Math.hypot(player.x - missileItem.x, player.y - missileItem.y);
        if (distPlayerMissile < player.radius + missileItem.radius) {
            console.log("Misil recogido!");
            missileItem.active = false; // Desactivar misil

            // Reproducir sonido de recogida
            playSound(missilePickupSoundBuffer, 0.8); // <<<--- SONIDO RECOGIDA

            // Añadir puntos por recoger el misil (opcional)
            score += 100;
            scoreElement.textContent = score;

            // Detener sonido y eliminar TODOS los zombies
            zombies.forEach(zombie => zombie.stopSound());
            zombies = []; // Vaciar el array de zombies

            console.log("Todos los zombies eliminados!");
        }
    }
}


function gameOver() {
    if (!gameRunning) return; // Evitar llamadas múltiples
    console.log("Game Over - Puntuación Final:", score);
    gameRunning = false; // Detener el bucle principal

    // <<<--- REPRODUCIR SONIDO DE MUERTE ---
    playSound(deathSoundBuffer, 0.7); // Ajusta el volumen como necesites

    finalScoreElement.textContent = score;
    checkAndSavePersonalBest(score); // Comprobar y guardar PB
    gameOverElement.style.display = 'flex'; // Mostrar pantalla game over

    // Detener todos los sonidos de zombies restantes (aunque no debería haber si la colisión fue correcta)
    zombies.forEach(zombie => zombie.stopSound());
    // Detener el bucle de animación
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    // Suspender el AudioContext para liberar recursos y evitar sonidos residuales
    if (audioContext && audioContext.state === 'running') {
        audioContext.suspend().then(() => console.log("AudioContext suspendido en Game Over."));
    }
}

function togglePause() {
    // ... (sin cambios)
    if (!gameRunning && !isPaused) return; // No pausar si ya es game over

    isPaused = !isPaused;
    console.log(`Juego ${isPaused ? 'PAUSADO' : 'REANUDADO'}`);
    pausedElement.style.display = isPaused ? 'flex' : 'none';

    if (audioContext) {
        if (isPaused && audioContext.state === 'running') {
             audioContext.suspend().then(() => console.log("AudioContext suspendido por pausa."));
        } else if (!isPaused && audioContext.state === 'suspended') {
             audioContext.resume().then(() => console.log("AudioContext reanudado tras pausa."));
        }
    }

    if (!isPaused && gameRunning) { // Solo reanudar loop si el juego estaba corriendo
        lastZombieSpawnTime = performance.now(); // Reajustar timer spawn zombie
        // Reajustar timer spawn misil para que no spawnee inmediatamente después de despausar
        missileItem.lastSpawnTime = performance.now();
        if (!animationId) { // Solo iniciar si no está ya corriendo (seguridad)
            animationId = requestAnimationFrame(gameLoop);
        }
    } else {
        // Si se pausa o si el juego ya terminó, detener el bucle
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }
}

// --- Bucle Principal del Juego ---
function gameLoop(timestamp) {
    // Si está pausado o terminó el juego, no hacer nada más que solicitar el siguiente frame si está pausado
    if (isPaused) {
        animationId = requestAnimationFrame(gameLoop); // Necesario para detectar despausa
        return;
    }
     // Si el juego terminó (gameRunning es false), no solicitar más frames
    if (!gameRunning) {
         if (animationId) cancelAnimationFrame(animationId); // Asegurar cancelación
         animationId = null;
         return;
    }

    // Limpiar Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dibujar Obstáculos (fondo)
    drawObstacles();

    // --- NUEVO: Spawner de Misil ---
    trySpawnMissile(timestamp);

    // --- NUEVO: Dibujar Misil (si está activo) ---
    drawMissile();

    // Actualizar/Dibujar Jugador
    player.update();

    // Actualizar/Dibujar Zombies
    zombies.forEach(zombie => zombie.update(player, timestamp));

    // Actualizar/Dibujar Balas (la colisión bala-zombie/valla se maneja en handleCollisions)
    // No es necesario iterar aquí si handleCollisions lo hace
    bullets.forEach(bullet => bullet.draw()); // Solo dibujar, la lógica de update/eliminación está en handleCollisions

    // Spawner Zombies
    if (timestamp - lastZombieSpawnTime > zombieSpawnInterval) {
        spawnZombie();
        lastZombieSpawnTime = timestamp;
    }

    // Manejar Colisiones (Bala-Zombie, Jugador-Zombie, Jugador-Misil, Bala-Valla)
    handleCollisions(); // Esta función ahora maneja más cosas y puede llamar a gameOver

    // Solicitar Siguiente Frame (solo si gameRunning sigue true después de handleCollisions)
    if (gameRunning) {
        animationId = requestAnimationFrame(gameLoop);
    } else {
        // Si handleCollisions llamó a gameOver, gameRunning será false y no se solicitará otro frame
        if (animationId) cancelAnimationFrame(animationId); // Asegurar cancelación
        animationId = null;
         console.log("Fin del bucle de juego debido a gameRunning=false.");
    }
}


// --- Event Listeners ---
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        togglePause();
        return; // Evitar que se registre la tecla Esc para movimiento
    }
    // Solo registrar teclas si el juego está activo y no pausado
    if (gameRunning && !isPaused) {
        keysPressed[e.key] = true;
    }
    // Llamar a la función de reanudación de audio (se auto-elimina)
    resumeAudioContextOnKey();
});

window.addEventListener('keyup', (e) => {
    // Siempre registrar keyup para evitar teclas "pegadas" si se sueltan durante pausa/gameover
    keysPressed[e.key] = false;
});

canvas.addEventListener('click', (event) => {
    // Llamar a la función de reanudación de audio (se auto-elimina)
    resumeAudioContextOnClick();

    // Solo disparar si el juego está activo y no pausado
    if (!gameRunning || isPaused) return;

    playSound(shootBuffer, 0.4); // Reproducir sonido de disparo

    const angle = Math.atan2(mousePos.y - player.y, mousePos.x - player.x);
    const bulletSpeed = 5;
    const velocity = { x: Math.cos(angle) * bulletSpeed, y: Math.sin(angle) * bulletSpeed };
    // Asegurar que la bala sale del 'cañón' y no del centro exacto
    const barrelLength = player.radius; // Nace justo en el borde del jugador
    const startX = player.x + barrelLength * Math.cos(angle);
    const startY = player.y + barrelLength * Math.sin(angle);

    bullets.push(new Bullet(startX, startY, 5, 'yellow', velocity));
});

canvas.addEventListener('mousemove', (event) => {
    // Actualizar posición del ratón siempre, incluso si está pausado (para la mira)
    const rect = canvas.getBoundingClientRect();
    mousePos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
});

restartButton.addEventListener('click', () => {
    console.log("Botón Reiniciar presionado.");
    // Detener cualquier sonido zombie residual por si acaso
    zombies.forEach(z => z.stopSound());
    zombies = []; // Limpiar array por si acaso
    gameOverElement.style.display = 'none'; // Ocultar pantalla game over
    init(); // Reiniciar el juego
});

// --- Iniciar el juego ---
console.log("Iniciando la aplicación...");
// Es importante llamar a initAudio() ANTES de init() para que los sonidos
// puedan empezar a cargarse mientras se inicializa el resto del juego.
// initAudio() ahora llama a loadSounds() internamente.
initAudio(); // <--- Llamar aquí para iniciar carga de sonidos
init(); // Llamar a init para configurar el estado inicial del juego