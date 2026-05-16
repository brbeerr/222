import { world, system } from "@minecraft/server";

/**
 * ============================================================
 * СКЕЛЕТЫ ПРЯЧУТСЯ ОТ СОЛНЦА
 * ============================================================
 * Вместо того чтобы гореть на солнце, скелеты бегут к ближайшему
 * затенённому месту (дерево, пещера, навес).
 * 
 * Механика:
 * - Днём скелеты проверяют есть ли тень рядом
 * - Если есть — бегут к ней (ускорение)
 * - Если нет тени рядом — горят как обычно
 * - Под деревьями/навесами не горят (даём огнестойкость)
 * - Работает для обычных скелетов и бродяг (stray)
 * ============================================================
 */

// ============ НАСТРОЙКИ ============
const CONFIG = {
  CHECK_INTERVAL: 40,               // Проверка каждые 2 секунды
  SHADE_SEARCH_RADIUS: 12,          // Радиус поиска тени
  SPEED_BOOST_LEVEL: 1,             // Уровень ускорения при беге к тени
  FIRE_RESISTANCE_DURATION: 5,      // Длительность огнестойкости в тени (сек)
  ONLY_OVERWORLD: true,             // Только в обычном мире
  APPLY_TO_STRAY: true,             // Применять к бродягам тоже
  MIN_LIGHT_FOR_BURN: 11,           // Минимальный свет для горения (ванилла = 11)
  MAX_SKELETONS_PER_CYCLE: 20,      // Макс. скелетов обрабатываемых за цикл
  PARTICLES_WHEN_HIDING: true,      // Частицы когда прячется
  PANIC_SPEED_DURATION: 4           // Длительность ускорения (сек)
};

// ============ ДАННЫЕ ============
let tickCounter = 0;

// Кэш позиций тени (обновляется каждые 10 сек)
const shadeCache = new Map(); // "x,y,z" -> true
let lastCacheClear = 0;

// ============ УТИЛИТЫ ============

/**
 * Проверяет есть ли блок-крыша над позицией
 */
function hasShadeAbove(dimension, pos) {
  const cacheKey = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  
  // Проверяем кэш
  if (shadeCache.has(cacheKey)) {
    return shadeCache.get(cacheKey);
  }

  try {
    // Ищем любой непрозрачный блок выше (до 20 блоков)
    for (let y = Math.floor(pos.y) + 1; y <= Math.floor(pos.y) + 20 && y < 320; y++) {
      const block = dimension.getBlock({
        x: Math.floor(pos.x),
        y: y,
        z: Math.floor(pos.z)
      });

      if (!block) continue;

      const typeId = block.typeId;

      // Непрозрачные блоки, которые дают тень
      if (typeId !== "minecraft:air" &&
          typeId !== "minecraft:glass" &&
          typeId !== "minecraft:glass_pane" &&
          !typeId.includes("stained_glass") &&
          typeId !== "minecraft:barrier" &&
          typeId !== "minecraft:light_block") {
        shadeCache.set(cacheKey, true);
        return true;
      }
    }
  } catch (e) {
    return false;
  }

  shadeCache.set(cacheKey, false);
  return false;
}

/**
 * Ищет ближайшую затенённую позицию рядом со скелетом
 */
function findNearestShade(dimension, skeletonPos) {
  let bestPos = null;
  let bestDistance = Infinity;

  const baseX = Math.floor(skeletonPos.x);
  const baseY = Math.floor(skeletonPos.y);
  const baseZ = Math.floor(skeletonPos.z);

  // Ищем по спирали от центра
  for (let radius = 2; radius <= CONFIG.SHADE_SEARCH_RADIUS; radius += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      for (let dz = -radius; dz <= radius; dz += 2) {
        // Только на краях (оптимизация)
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

        const checkPos = {
          x: baseX + dx,
          y: baseY,
          z: baseZ + dz
        };

        // Проверяем что позиция проходима
        try {
          const blockAt = dimension.getBlock(checkPos);
          const blockAbove = dimension.getBlock({
            x: checkPos.x,
            y: checkPos.y + 1,
            z: checkPos.z
          });

          if (!blockAt || !blockAbove) continue;
          if (blockAt.typeId !== "minecraft:air") continue;
          if (blockAbove.typeId !== "minecraft:air") continue;

          // Проверяем есть ли тень
          if (!hasShadeAbove(dimension, checkPos)) continue;

          // Вычисляем расстояние
          const dist = Math.abs(dx) + Math.abs(dz); // Манхеттен
          if (dist < bestDistance) {
            bestDistance = dist;
            bestPos = checkPos;
          }
        } catch (e) {
          continue;
        }
      }
    }

    // Нашли тень на этом радиусе — не ищем дальше
    if (bestPos) break;
  }

  return bestPos;
}

/**
 * Проверяет сейчас ли день (опасное время для скелетов)
 */
function isDaytime() {
  try {
    const time = world.getTimeOfDay();
    return time >= 0 && time <= 12500;
  } catch (e) {
    return false;
  }
}

/**
 * Проверяет горит ли скелет (есть компонент огня)
 */
function isOnFire(entity) {
  try {
    const onFire = entity.getComponent("minecraft:onfire");
    return !!onFire;
  } catch (e) {
    return false;
  }
}

/**
 * Двигает скелет к целевой позиции
 */
function moveSkeletonToShade(dimension, skeleton, targetPos) {
  try {
    // Даём ускорение
    dimension.runCommand(
      `effect @e[type=skeleton,x=${Math.floor(skeleton.location.x)},y=${Math.floor(skeleton.location.y)},z=${Math.floor(skeleton.location.z)},r=1,c=1] speed ${CONFIG.PANIC_SPEED_DURATION} ${CONFIG.SPEED_BOOST_LEVEL} true`
    );

    // Телепортируем к тени (медленно, шаг за шагом)
    const currentPos = skeleton.location;
    const dx = targetPos.x - currentPos.x;
    const dz = targetPos.z - currentPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 2) {
      // Уже рядом с тенью — даём огнестойкость
      dimension.runCommand(
        `effect @e[type=skeleton,x=${Math.floor(currentPos.x)},y=${Math.floor(currentPos.y)},z=${Math.floor(currentPos.z)},r=1,c=1] fire_resistance ${CONFIG.FIRE_RESISTANCE_DURATION} 0 true`
      );
      return;
    }

    // Двигаем на 2 блока в сторону тени
    const moveX = (dx / dist) * 2;
    const moveZ = (dz / dist) * 2;

    const newPos = {
      x: currentPos.x + moveX,
      y: currentPos.y,
      z: currentPos.z + moveZ
    };

    // Проверяем что новая позиция проходима
    const blockAtNew = dimension.getBlock({
      x: Math.floor(newPos.x),
      y: Math.floor(newPos.y),
      z: Math.floor(newPos.z)
    });

    if (blockAtNew && blockAtNew.typeId === "minecraft:air") {
      skeleton.teleport(newPos, { dimension: dimension });
    }

    // Частицы паники
    if (CONFIG.PARTICLES_WHEN_HIDING) {
      dimension.runCommand(
        `particle minecraft:basic_smoke_particle ${currentPos.x} ${currentPos.y + 1} ${currentPos.z}`
      );
    }
  } catch (e) {
    // Не критично
  }
}

// ============ ОСНОВНОЙ ЦИКЛ ============
system.runInterval(() => {
  tickCounter++;
  if (tickCounter % CONFIG.CHECK_INTERVAL !== 0) return;

  // Только днём
  if (!isDaytime()) return;

  // Чистим кэш каждые 30 сек
  if (tickCounter - lastCacheClear > 600) {
    shadeCache.clear();
    lastCacheClear = tickCounter;
  }

  const overworld = world.getDimension("overworld");

  try {
    // Получаем скелетов
    const skeletons = overworld.getEntities({ type: "minecraft:skeleton" });

    let processed = 0;

    for (const skeleton of skeletons) {
      if (processed >= CONFIG.MAX_SKELETONS_PER_CYCLE) break;

      const pos = skeleton.location;

      // Проверяем уже ли в тени
      if (hasShadeAbove(overworld, pos)) {
        // В тени — даём огнестойкость и пропускаем
        try {
          overworld.runCommand(
            `effect @e[type=skeleton,x=${Math.floor(pos.x)},y=${Math.floor(pos.y)},z=${Math.floor(pos.z)},r=1,c=1] fire_resistance ${CONFIG.FIRE_RESISTANCE_DURATION} 0 true`
          );
        } catch (e) {}
        continue;
      }

      // На солнце — ищем тень
      const shadePos = findNearestShade(overworld, pos);

      if (shadePos) {
        // Нашли тень — бежим к ней
        moveSkeletonToShade(overworld, skeleton, shadePos);
        processed++;
      }
      // Если тени нет — горит как обычно (не вмешиваемся)
    }

    // То же для бродяг
    if (CONFIG.APPLY_TO_STRAY) {
      const strays = overworld.getEntities({ type: "minecraft:stray" });

      for (const stray of strays) {
        if (processed >= CONFIG.MAX_SKELETONS_PER_CYCLE) break;

        const pos = stray.location;

        if (hasShadeAbove(overworld, pos)) {
          try {
            overworld.runCommand(
              `effect @e[type=stray,x=${Math.floor(pos.x)},y=${Math.floor(pos.y)},z=${Math.floor(pos.z)},r=1,c=1] fire_resistance ${CONFIG.FIRE_RESISTANCE_DURATION} 0 true`
            );
          } catch (e) {}
          continue;
        }

        const shadePos = findNearestShade(overworld, pos);
        if (shadePos) {
          moveSkeletonToShade(overworld, stray, shadePos);
          processed++;
        }
      }
    }
  } catch (e) {
    // Не критично
  }
}, 20);
