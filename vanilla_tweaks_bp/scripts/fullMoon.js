import { world, system } from "@minecraft/server";

/**
 * ============================================================
 * ПОЛНОЛУНИЕ — ДВОЙНОЙ СПАВН МОБОВ
 * ============================================================
 * В ночь полнолуния враждебные мобы спавнятся в два раза чаще.
 * Реализация: каждые 10 секунд ночью при полной луне
 * спавним дополнительных мобов рядом с игроками.
 * 
 * Механика:
 * - Определяем фазу луны (Bedrock: day % 8)
 * - Полнолуние = фаза 0
 * - Ночью спавним доп. мобов в тёмных местах рядом с игроком
 * - Предупреждение в чат при наступлении полнолуния
 * ============================================================
 */

// ============ НАСТРОЙКИ ============
const CONFIG = {
  SPAWN_INTERVAL: 200,              // Каждые 10 секунд
  SPAWN_RADIUS_MIN: 24,            // Минимальный радиус от игрока
  SPAWN_RADIUS_MAX: 48,            // Максимальный радиус от игрока
  MAX_EXTRA_MOBS_PER_CYCLE: 3,     // Макс. доп. мобов за цикл на игрока
  SPAWN_CHANCE: 0.60,              // 60% шанс спавна за цикл
  NOTIFY_ON_FULLMOON: true,        // Уведомлять о полнолунии
  WARNING_BEFORE_NIGHT: true,      // Предупреждать перед ночью
  PARTICLES_ON_SPAWN: true,        // Частицы при спавне
  BOSS_CHANCE: 0.05,               // 5% шанс что моб будет усиленный
  MAX_MOBS_IN_AREA: 30             // Не спавнить если уже много мобов
};

// Мобы которые спавнятся дополнительно
const SPAWN_MOBS = [
  { type: "minecraft:zombie", weight: 25 },
  { type: "minecraft:skeleton", weight: 25 },
  { type: "minecraft:spider", weight: 20 },
  { type: "minecraft:creeper", weight: 15 },
  { type: "minecraft:witch", weight: 5 },
  { type: "minecraft:enderman", weight: 5 },
  { type: "minecraft:phantom", weight: 5 }
];

// Общий вес для выбора
const TOTAL_WEIGHT = SPAWN_MOBS.reduce((sum, mob) => sum + mob.weight, 0);

// ============ ДАННЫЕ ============
let tickCounter = 0;
let isFullMoon = false;
let notifiedThisNight = false;
let lastDayChecked = -1;

// ============ УТИЛИТЫ ============

/**
 * Определяет фазу луны (0 = полнолуние)
 * В Bedrock: фаза = Math.floor(dayCount) % 8
 * 0 = полная луна
 */
function getMoonPhase() {
  try {
    const dayCount = world.getDay();
    return dayCount % 8;
  } catch (e) {
    return -1;
  }
}

/**
 * Проверяет ночь ли сейчас
 */
function isNightTime() {
  try {
    const time = world.getTimeOfDay();
    return time > 13000 && time < 23000;
  } catch (e) {
    return false;
  }
}

/**
 * Выбирает случайного моба из таблицы с учётом веса
 */
function getRandomMob() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const mob of SPAWN_MOBS) {
    roll -= mob.weight;
    if (roll <= 0) return mob.type;
  }
  return SPAWN_MOBS[0].type;
}

/**
 * Находит безопасную позицию для спавна
 */
function findSpawnPosition(dimension, playerPos) {
  const angle = Math.random() * Math.PI * 2;
  const distance = CONFIG.SPAWN_RADIUS_MIN + Math.random() * (CONFIG.SPAWN_RADIUS_MAX - CONFIG.SPAWN_RADIUS_MIN);

  const x = Math.floor(playerPos.x + Math.cos(angle) * distance);
  const z = Math.floor(playerPos.z + Math.sin(angle) * distance);

  // Ищем поверхность сверху вниз
  for (let y = Math.floor(playerPos.y) + 10; y >= Math.floor(playerPos.y) - 10; y--) {
    try {
      const blockAt = dimension.getBlock({ x, y, z });
      const blockAbove = dimension.getBlock({ x, y: y + 1, z });
      const blockAbove2 = dimension.getBlock({ x, y: y + 2, z });

      if (!blockAt || !blockAbove || !blockAbove2) continue;

      // Твёрдый блок снизу, воздух сверху (2 блока)
      if (blockAt.typeId !== "minecraft:air" &&
          blockAt.typeId !== "minecraft:water" &&
          blockAt.typeId !== "minecraft:lava" &&
          blockAbove.typeId === "minecraft:air" &&
          blockAbove2.typeId === "minecraft:air") {
        return { x: x + 0.5, y: y + 1, z: z + 0.5 };
      }
    } catch (e) {
      continue;
    }
  }

  return null;
}

/**
 * Считает враждебных мобов рядом с позицией
 */
function countHostileMobsNear(dimension, pos) {
  try {
    const mobs = dimension.getEntities({
      location: pos,
      maxDistance: CONFIG.SPAWN_RADIUS_MAX,
      families: ["monster"]
    });
    return mobs.length;
  } catch (e) {
    // Если families не поддерживается, считаем вручную
    try {
      let count = 0;
      const hostileTypes = ["zombie", "skeleton", "spider", "creeper", "witch", "enderman", "phantom"];
      for (const ht of hostileTypes) {
        const mobs = dimension.getEntities({
          type: `minecraft:${ht}`,
          location: pos,
          maxDistance: CONFIG.SPAWN_RADIUS_MAX
        });
        count += mobs.length;
      }
      return count;
    } catch (e2) {
      return 0;
    }
  }
}

/**
 * Спавнит усиленного моба (с эффектами)
 */
function spawnBossMob(dimension, pos, mobType) {
  try {
    const entity = dimension.spawnEntity(mobType, pos);
    // Даём эффекты
    entity.addTag("fullmoon_boss");
    dimension.runCommand(
      `effect @e[tag=fullmoon_boss,c=1] strength 999999 1 true`
    );
    dimension.runCommand(
      `effect @e[tag=fullmoon_boss,c=1] resistance 999999 1 true`
    );
    dimension.runCommand(
      `effect @e[tag=fullmoon_boss,c=1] speed 999999 0 true`
    );
    return entity;
  } catch (e) {
    return null;
  }
}

// ============ ОСНОВНОЙ ЦИКЛ ============
system.runInterval(() => {
  tickCounter++;

  // Проверка фазы луны каждый новый день
  const currentDay = world.getDay();
  if (currentDay !== lastDayChecked) {
    lastDayChecked = currentDay;
    const phase = getMoonPhase();
    isFullMoon = (phase === 0);
    notifiedThisNight = false;
  }

  // Если не полнолуние — ничего не делаем
  if (!isFullMoon) return;

  // Проверяем ночь
  if (!isNightTime()) return;

  // Уведомление при наступлении ночи полнолуния
  if (!notifiedThisNight && CONFIG.NOTIFY_ON_FULLMOON) {
    notifiedThisNight = true;
    world.sendMessage("§c[Полнолуние] §fЛуна полная... Монстры выходят в удвоенном количестве!");
    world.sendMessage("§7 Будьте осторожны этой ночью.");
  }

  // Спавн только каждые N тиков
  if (tickCounter % CONFIG.SPAWN_INTERVAL !== 0) return;

  // Шанс
  if (Math.random() > CONFIG.SPAWN_CHANCE) return;

  const overworld = world.getDimension("overworld");

  try {
    const players = world.getAllPlayers();

    for (const player of players) {
      const playerPos = player.location;

      // Проверяем количество мобов рядом
      const mobCount = countHostileMobsNear(overworld, playerPos);
      if (mobCount >= CONFIG.MAX_MOBS_IN_AREA) continue;

      // Спавним доп. мобов
      const spawnCount = 1 + Math.floor(Math.random() * CONFIG.MAX_EXTRA_MOBS_PER_CYCLE);

      for (let i = 0; i < spawnCount; i++) {
        const spawnPos = findSpawnPosition(overworld, playerPos);
        if (!spawnPos) continue;

        const mobType = getRandomMob();

        try {
          // Шанс на босс-моба
          if (Math.random() < CONFIG.BOSS_CHANCE) {
            spawnBossMob(overworld, spawnPos, mobType);
          } else {
            overworld.spawnEntity(mobType, spawnPos);
          }

          // Частицы
          if (CONFIG.PARTICLES_ON_SPAWN) {
            overworld.runCommand(
              `particle minecraft:basic_smoke_particle ${spawnPos.x} ${spawnPos.y} ${spawnPos.z}`
            );
          }
        } catch (e) {
          // Не удалось заспавнить — не критично
        }
      }
    }
  } catch (e) {
    // Не критично
  }
}, 20);
