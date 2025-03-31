// --- Elementos del DOM ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const gameOverElement = document.getElementById('game-over');
const finalScoreElement = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');
const pausedElement = document.getElementById('paused');
const gameContainer = document.getElementById('game-container');

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

// --- Audio ---
let audioContext; // <<<--- DECLARACIÓN GLOBAL IMPORTANTE
let shootBuffer = null;
let zombieBuffer = null;
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
        alert(`Error al cargar el sonido ${url}. Verifica que el archivo existe y no está corrupto.`);
        return null;
    }
}

async function loadSounds() {
    try {
        [shootBuffer, zombieBuffer] = await Promise.all([
            loadSound('shoot.mp3'),
            loadSound('zombie.mp3')
        ]);
        console.log("Proceso de carga de sonidos finalizado.");
        if (!shootBuffer) console.warn("Buffer de disparo NO cargado.");
        if (!zombieBuffer) console.warn("Buffer de zombie NO cargado.");
    } catch (error) {
        console.error("Error durante la carga paralela de sonidos:", error);
    }
}

function playSound(buffer, volume = 1.0, loop = false) {
    if (!audioContext || !buffer) return null;
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            playSoundInternal(buffer, volume, loop);
        }).catch(e => console.error("Error al reanudar AudioContext:", e));
        return null;
    } else {
        return playSoundInternal(buffer, volume, loop);
    }
}

function playSoundInternal(buffer, volume, loop) {
    try {
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        source.buffer = buffer;
        source.loop = loop;
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        source.start(0);
        return { source, gainNode };
    } catch (e) {
        console.error("Error al reproducir sonido:", e);
        return null;
    }
}

function resumeAudioContextOnClick() { /* ... (igual que antes, con removeEventListener) ... */
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => console.log("AudioContext reanudado por click."))
                       .catch(e => console.error("Error reanudando AudioContext por click:", e));
    }
    document.body.removeEventListener('click', resumeAudioContextOnClick);
    document.body.removeEventListener('keydown', resumeAudioContextOnKey);
}
function resumeAudioContextOnKey() { /* ... (igual que antes, con removeEventListener) ... */
     if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => console.log("AudioContext reanudado por tecla."))
                       .catch(e => console.error("Error reanudando AudioContext por tecla:", e));
    }
    document.body.removeEventListener('click', resumeAudioContextOnClick);
    document.body.removeEventListener('keydown', resumeAudioContextOnKey);
}
document.body.addEventListener('click', resumeAudioContextOnClick, { once: true });
document.body.addEventListener('keydown', resumeAudioContextOnKey, { once: true });


// --- Funciones de Ayuda para Colisiones y Obstáculos ---
function checkRectCollision(rect1, rect2) {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
}

function checkEntityFenceCollision(entity, nextX, nextY) {
    const entityRadius = entity.radius;
    const entityRect = { // Bounding box futuro de la entidad
        x: nextX - entityRadius,
        y: nextY - entityRadius,
        width: entityRadius * 2,
        height: entityRadius * 2,
    };

    for (const obstacle of obstacles) {
        if (obstacle.type === 'fence') {
            if (checkRectCollision(entityRect, obstacle)) {
                return true; // Colisión con valla
            }
        }
    }
    return false; // Sin colisión con vallas
}

function isEntityInBush(entity) {
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

// --- Clases del Juego ---
class Player {
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

        // Comprobar colisión X
        if (checkEntityFenceCollision(this, targetX, this.y)) {
            targetX = this.x; // No mover en X si choca
        }

        // Comprobar colisión Y
        if (checkEntityFenceCollision(this, targetX, targetY)) { // Usar targetX (que pudo ser ajustado)
            targetY = this.y; // No mover en Y si choca
        }

        // Comprobar de nuevo la X por si el ajuste de Y causó colisión en X
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
    constructor(x, y, radius, color, speed) {
        this.x = x; this.y = y; this.radius = radius; this.color = color; this.speed = speed;
        this.audioSource = null; this.gainNode = null;

        // --- NUEVAS PROPIEDADES PARA MOVIMIENTO IMPREDECIBLE ---
        this.targetAngle = 0; // El ángulo hacia el que intenta moverse actualmente
        // Intervalo de actualización de ángulo variable (entre 300ms y 500ms)
        this.angleUpdateInterval = 300 + Math.random() * 200;
        this.lastAngleUpdateTime = 0; // Momento de la última actualización
        // Máxima desviación angular (ej: +/- 15 grados)
        this.maxAngleDeviation = Math.PI / 12;
        this.moveChance = 0.98; // 98% de probabilidad de moverse cada frame (2% pausa)
        // --- FIN NUEVAS PROPIEDADES ---
    }

    draw() {
        const inBush = isEntityInBush(this);
        const originalAlpha = ctx.globalAlpha; // Guardar opacidad actual

        ctx.globalAlpha = inBush ? BUSH_ALPHA : 1.0; // Ajustar opacidad

        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = originalAlpha; // Restaurar opacidad
    }

    update(target, timestamp) { // <<<--- AÑADIR timestamp como parámetro
        // --- NUEVO: Pausa aleatoria ---
        if (Math.random() > this.moveChance) {
            this.draw(); // Asegurarse de dibujarlo aunque no se mueva
            // No actualizamos audio si está pausado, para evitar saltos de volumen
            return; // Salir temprano, no mover este frame
        }
        // --- FIN Pausa aleatoria ---

        // --- NUEVO: Actualización periódica del ángulo objetivo con desviación ---
        if (timestamp - this.lastAngleUpdateTime > this.angleUpdateInterval) {
            // Calcular ángulo directo al jugador
            const directAngle = Math.atan2(target.y - this.y, target.x - this.x);
            // Calcular desviación aleatoria
            const randomOffset = (Math.random() * 2 - 1) * this.maxAngleDeviation;
            // Establecer nuevo ángulo objetivo (directo + desviación)
            this.targetAngle = directAngle + randomOffset;
            // Registrar tiempo de actualización
            this.lastAngleUpdateTime = timestamp;
        }
        // --- FIN Actualización periódica ---

        // Calcular movimiento basado en el ángulo objetivo *actual* (que puede ser antiguo)
        const deltaX = Math.cos(this.targetAngle) * this.speed;
        const deltaY = Math.sin(this.targetAngle) * this.speed;

        // Lógica de colisión con vallas (igual que antes)
        let targetX = this.x + deltaX;
        let targetY = this.y + deltaY;
        if (checkEntityFenceCollision(this, targetX, this.y)) targetX = this.x;
        if (checkEntityFenceCollision(this, targetX, targetY)) targetY = this.y;
        if (targetX !== this.x && checkEntityFenceCollision(this, targetX, targetY)) targetX = this.x; // Re-check X

        this.x = targetX;
        this.y = targetY;

        // Actualizar volumen del sonido (igual que antes)
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

        this.draw(); // Dibujar al final
    }

    stopSound() {
         if (this.audioSource) {
            try {
                 this.audioSource.stop(); this.audioSource.disconnect();
                 if (this.gainNode) this.gainNode.disconnect();
                 // console.log("Sonido de zombie detenido."); // Log opcional
             } catch(e) {/* Ignorar errores si ya detenido */}
             this.audioSource = null; this.gainNode = null;
        }
    }
}

// --- Funciones del Juego ---
function drawObstacles() {
    obstacles.forEach(obstacle => {
        ctx.fillStyle = obstacle.color;
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    });
}

function createObstacles() {
    obstacles = []; // Limpiar

    // Vallas (Ajusta posiciones/tamaños como quieras)
    obstacles.push({ type: 'fence', x: 100, y: 150, width: 150, height: 20, color: FENCE_COLOR });
    obstacles.push({ type: 'fence', x: canvasWidth - 250, y: canvasHeight - 170, width: 150, height: 20, color: FENCE_COLOR });
    obstacles.push({ type: 'fence', x: canvasWidth / 2 - 10, y: 50, width: 20, height: 100, color: FENCE_COLOR });
    obstacles.push({ type: 'fence', x: canvasWidth / 2 - 10, y: canvasHeight - 150, width: 20, height: 100, color: FENCE_COLOR });
    obstacles.push({ type: 'fence', x: 200, y: canvasHeight / 2 - 10, width: 100, height: 20, color: FENCE_COLOR }); // Valla central H


    // Arbustos (Ajusta posiciones/tamaños como quieras)
    obstacles.push({ type: 'bush', x: 200, y: canvasHeight - 100, width: 100, height: 80, color: BUSH_COLOR });
    obstacles.push({ type: 'bush', x: canvasWidth - 300, y: 80, width: 120, height: 60, color: BUSH_COLOR });
    obstacles.push({ type: 'bush', x: 50, y: canvasHeight / 2 - 40, width: 80, height: 80, color: BUSH_COLOR });
    obstacles.push({ type: 'bush', x: canvasWidth - 150, y: canvasHeight / 2 - 50, width: 100, height: 100, color: BUSH_COLOR });


    console.log("Obstáculos creados:", obstacles.length);
}


function init() {
    console.log("--- Iniciando Juego ---");
    // Asegurar que initAudio se llama si audioContext no existe
    if (!audioContext) initAudio(); // <--- Comprobación clave

    createObstacles(); // Crear obstáculos

    // Asegurar que el jugador no spawnee dentro de una valla
    let validPlayerPos = false;
    let playerX = canvasWidth / 2;
    let playerY = canvasHeight / 2;
    let attempts = 0;
    while (!validPlayerPos && attempts < 10) {
        const tempPlayer = { x: playerX, y: playerY, radius: 15 };
        if (!checkEntityFenceCollision(tempPlayer, playerX, playerY)) {
            validPlayerPos = true;
        } else {
            console.warn("Posición inicial jugador choca! Ajustando...");
            playerX += 25; // Mover un poco e intentar de nuevo
            playerY += 10;
            attempts++;
        }
    }
     if (!validPlayerPos) {
         console.error("NO SE PUDO COLOCAR AL JUGADOR FUERA DE VALLAS!");
         // Podrías ponerlo en 0,0 o dejarlo donde estaba
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
    zombieSpawnInterval = 1500;
    scoreElement.textContent = score;
    gameOverElement.style.display = 'none';
    pausedElement.style.display = 'none';
    keysPressed = {};
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null; // Resetear
    console.log("Iniciando nuevo gameLoop...");
    animationId = requestAnimationFrame(gameLoop);
    console.log("--- Inicialización Completa ---");
}

function spawnZombie() {
    const radius = Math.random() * 10 + 10;
    const speed = Math.random() * 1 + 0.5;
    const color = 'green';
    let x, y;
    let validSpawn = false;
    let attempts = 0;

    while (!validSpawn && attempts < 50) {
        attempts++;
        if (Math.random() < 0.5) { /* ... spawn horizontal ... */
            x = Math.random() * canvas.width; y = Math.random() < 0.5 ? 0 - radius : canvas.height + radius;
        } else { /* ... spawn vertical ... */
            x = Math.random() < 0.5 ? 0 - radius : canvas.width + radius; y = Math.random() * canvas.height;
        }

        const tempZombie = { x: x, y: y, radius: radius };
        if (!checkEntityFenceCollision(tempZombie, x, y)) {
            validSpawn = true;
        }
    }

    if (validSpawn) {
        const newZombie = new Zombie(x, y, radius, color, speed);
        zombies.push(newZombie);

        // Iniciar sonido DESPUÉS de crear y validar el zombie
        if (zombieBuffer && audioContext && audioContext.state === 'running') {
            const audioNodes = playSoundInternal(zombieBuffer, 0, true);
            if (audioNodes) {
                newZombie.audioSource = audioNodes.source;
                newZombie.gainNode = audioNodes.gainNode;
            }
        }
    } else {
        console.warn("No se pudo spawnear zombie fuera de vallas.");
    }
}

function handleCollisions() {
    // Bala - Zombie
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        if (!bullet) continue;
        for (let j = zombies.length - 1; j >= 0; j--) {
            const zombie = zombies[j];
            const dist = Math.hypot(bullet.x - zombie.x, bullet.y - zombie.y);
            if (dist - zombie.radius - bullet.radius < 1) {
                zombie.stopSound();
                score += 10; scoreElement.textContent = score;
                bullets.splice(i, 1); zombies.splice(j, 1);
                zombieSpawnInterval = Math.max(300, zombieSpawnInterval * 0.99);
                break; // Salir bucle interno (j)
            }
        }
    }

    // Jugador - Zombie
    if (!gameRunning) return; // No comprobar si ya terminó por colisión bala-zombie(?) No debería pasar
    for (let j = zombies.length - 1; j >= 0; j--) {
        const zombie = zombies[j];
        if (!zombie) continue; // Por si acaso fue eliminado justo antes
        const dist = Math.hypot(player.x - zombie.x, player.y - zombie.y);
        if (dist - zombie.radius - player.radius < 1) {
            gameOver();
            return; // Salir de handleCollisions
        }
    }
}

function gameOver() {
    if (!gameRunning) return;
    console.log("Ejecutando gameOver...");
    gameRunning = false;
    finalScoreElement.textContent = score;
    gameOverElement.style.display = 'flex';
    zombies.forEach(zombie => zombie.stopSound());
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    if (audioContext && audioContext.state === 'running') {
        audioContext.suspend().then(() => console.log("AudioContext suspendido en Game Over."));
    }
}

function togglePause() {
    if (!gameRunning) return;
    isPaused = !isPaused;
    console.log(`Juego ${isPaused ? 'PAUSADO' : 'REANUDADO'}`);
    pausedElement.style.display = isPaused ? 'flex' : 'none';

    if (audioContext) {
        if (isPaused && audioContext.state === 'running') audioContext.suspend();
        else if (!isPaused && audioContext.state === 'suspended') audioContext.resume();
    }

    if (!isPaused) {
        lastZombieSpawnTime = performance.now();
        if (animationId) cancelAnimationFrame(animationId); // Cancelar por si acaso
        animationId = requestAnimationFrame(gameLoop); // Reiniciar bucle
    } else {
        if (animationId) cancelAnimationFrame(animationId); // Detener bucle al pausar
        animationId = null;
    }
}

// --- Bucle Principal del Juego ---
function gameLoop(timestamp) {
    if (!gameRunning || isPaused) {
        // Si está pausado, solicitar el frame para poder despausar.
        // Si es game over, no solicitar más frames.
        if (isPaused) animationId = requestAnimationFrame(gameLoop);
        return;
    }

    // Limpiar
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dibujar Fondo/Obstáculos
    drawObstacles();

    // Actualizar/Dibujar Entidades
    player.update();
    zombies.forEach(zombie => zombie.update(player, timestamp));

    // Actualizar Balas y Comprobar Colisiones / Fuera de Pantalla
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.update(); // Mueve y dibuja la bala

        // Comprobar colisión con vallas O si está fuera de pantalla
        if (checkBulletFenceCollision(bullet) || // <<<--- NUEVA COMPROBACIÓN
            bullet.x + bullet.radius < 0 ||
            bullet.x - bullet.radius > canvas.width ||
            bullet.y + bullet.radius < 0 ||
            bullet.y - bullet.radius > canvas.height)
        {
            // Eliminar la bala inmediatamente
            bullets.splice(i, 1);
        }
    }


    // Spawner
    if (timestamp - lastZombieSpawnTime > zombieSpawnInterval) {
        spawnZombie();
        lastZombieSpawnTime = timestamp;
    }

    // Colisiones
    handleCollisions(); // Puede cambiar gameRunning a false

    // Siguiente Frame (solo si el juego no ha terminado)
    if (gameRunning) {
        animationId = requestAnimationFrame(gameLoop);
    } else {
        // Asegurar que se cancela si handleCollisions causó gameOver
        if (animationId) cancelAnimationFrame(animationId);
        animationId = null;
    }
}


// --- Event Listeners ---
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { togglePause(); return; }
    if (gameRunning && !isPaused) keysPressed[e.key] = true;
    resumeAudioContextOnKey(); // Llama a la función que se auto-elimina
});

window.addEventListener('keyup', (e) => {
    keysPressed[e.key] = false;
});

canvas.addEventListener('click', (event) => {
    resumeAudioContextOnClick(); // Llama a la función que se auto-elimina
    if (!gameRunning || isPaused) return;
    playSound(shootBuffer, 0.4); // Usa la función segura
    const angle = Math.atan2(mousePos.y - player.y, mousePos.x - player.x);
    const bulletSpeed = 5;
    const velocity = { x: Math.cos(angle) * bulletSpeed, y: Math.sin(angle) * bulletSpeed };
    bullets.push(new Bullet(player.x, player.y, 5, 'yellow', velocity));
});

canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mousePos = { x: event.clientX - rect.left, y: event.clientY - rect.top };
});

restartButton.addEventListener('click', () => {
    console.log("Botón Reiniciar presionado.");
    init();
});

// --- Iniciar el juego ---
console.log("Iniciando la aplicación...");
init(); // Llamar a init al cargar la página