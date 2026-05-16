import { world, system, BlockPermutation } from "@minecraft/server";

/**
 * ============================================================
 * ПЕЩЕРНЫЕ ПАУКИ ПЛЕТУТ ПАУТИНУ
 * ============================================================
 * Пещерные пауки (cave_spider) оставляют паутину за собой,
 * когда перемещаются в тёмных местах (уровень света < 7).
 * 
 * Механика:
 * - Только пещерные пауки (не обычные)
 * - Только в темноте (свет < 7) — т.е. в пещерах
 * - Шанс оставить паутину: 10% каждые 5 секунд
 * - Паутина исчезает через 2 минуты (не засоряет мир)
 * - Максимум 30 паутин от одного паука
 * ============================================================
 */

// ============ НАСТРОЙКИ ============
const CONFIG = {
  CHECK_INTERVAL: 100,              // Каждые 5 секунд
  WEB_CHANCE: 0.10,                 // 10% шанс за проверку
  MAX_LIGHT_LEVEL: 7,               // Максимальный свет для плетения
  WEB_LIFETIME_TICKS: 2400,         // 2 минуты — паутина исчезает
  MAX_WEBS_PER_SPIDER: 30,          // Макс. паутин от одного паука
  MAX_WEBS_IN_AREA: 15,             // Макс. паутин в радиусе 10 блоков
  AREA_CHECK_RADIUS: 10,            // Радиус проверки плотности
  ONLY_CAVE_SPIDERS: true,          // Только пещерные пауки
  PARTICLES_ON_PLACE: true,         // Частицы при создании паутины
  WEB_BELOW_Y: 50,                  // Только ниже Y=50 (пещеры)
  CLEANUP_ENABLED: true             // Автоочистка старых паутин
};

// ============ ДАННЫЕ ============
// Отслеживание размещённых паутин для автоочистки
const placedWebs = []; // { position: {x,y,z}, placedTick: number, dimension: string }
const spiderWebCount = new Map(); // spiderId -> количество паутин

let tickCounter = 0;

// ============ УТИЛИТЫ ============

/**
 * Проверяет уровень света в позиции
 * Используем косвенный метод — проверяем есть ли рядом источники света
 */
function isDarkEnough(dimension, pos) {
  // Проверяем что позиция достаточно глубоко (пещера)
  if (pos.y > CONFIG.WEB_BELOW_Y) return false;
  
  // Проверяем нет ли рядом источников света
  const lightSources = [
    "minecraft:torch", "minecraft:soul_torch",
    "minecraft:lantern", "minecraft:soul_lantern",
    "minecraft:glowstone", "minecraft:sea_lantern",
    "minecraft:shroomlight", "minecraft:jack_o_lantern",
    "minecraft:campfire", "minecraft:soul_campfire",
    "minecraft:lava", "minecraft:redstone_lamp"
  ];
  
  try {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          const checkPos = {
            x: Math.floor(pos.x) + dx,
            y: Math.floor(pos.y) + dy,
            z: Math.floor(pos.z) + dz
          };
          const block = dimension.getBlock(checkPos);
          if (block && lightSources.includes(block.typeId)) {
            return false; // Есть источник света — слишком светло
          }
        }
      }
    }
  } catch (e) {
    return false;
  }
  
  return true; // Темно — можно плести
}

/**
 * Считает паутины в радиусе
 */
function countWebsInArea(dimension, pos) {
  let count = 0;
  try {
    for (let dx = -CONFIG.AREA_CHECK_RADIUS; dx <= CONFIG.AREA_CHECK_RADIUS; dx += 2) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -CONFIG.AREA_CHECK_RADIUS; dz <= CONFIG.AREA_CHECK_RADIUS; dz += 2) {
          const checkPos = {
            x: Math.floor(pos.x) + dx,
            y: Math.floor(pos.y) + dy,
            z: Math.floor(pos.z) + dz
          };
          const block = dimension.getBlock(checkPos);
          if (block && block.typeId === "minecraft:web") {
            count++;
          }
        }
      }
    }
  } catch (e) {
    // Не критично
  }
  return count;
}

/**
 * Находит подходящую позицию для паутины рядом с пауком
 */
function findWebPosition(dimension, spiderPos) {
  // Пробуем позицию за пауком (где он был)
  const offsets = [
    { x: 0, y: 0, z: 0 },      // Текущая позиция
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 1, z: 0 },      // Выше (на стене)
    { x: 1, y: 1, z: 0 },
    { x: -1, y: 1, z: 0 },
    { x: 0, y: 1, z: 1 },
    { x: 0, y: 1, z: -1 }
  ];
  
  // Перемешиваем для рандома
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
  }
  
  for (const offset of offsets) {
    const pos = {
      x: Math.floor(spiderPos.x) + offset.x,
      y: Math.floor(spiderPos.y) + offset.y,
      z: Math.floor(spiderPos.z) + offset.z
    };
    
    try {
      const block = dimension.getBlock(pos);
      if (!block) continue;
      
      // Только на воздух
      if (block.typeId !== "minecraft:air") continue;
      
      // Должна быть стена/потолок рядом (паутина "крепится")
      const hasAttachment = checkAttachment(dimension, pos);
      if (!hasAttachment) continue;
      
      return pos;
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

/**
 * Проверяет есть ли твёрдый блок рядом (для крепления паутины)
 */
function checkAttachment(dimension, pos) {
  const checkPositions = [
    { x: pos.x, y: pos.y + 1, z: pos.z }, // Потолок
    { x: pos.x + 1, y: pos.y, z: pos.z }, // Стены
    { x: pos.x - 1, y: pos.y, z: pos.z },
    { x: pos.x, y: pos.y, z: pos.z + 1 },
    { x: pos.x, y: pos.y, z: pos.z - 1 }
  ];
  
  for (const checkPos of checkPositions) {
    try {
      const block = dimension.getBlock(checkPos);
      if (block && block.typeId !== "minecraft:air" && 
          block.typeId !== "minecraft:web" && 
          block.typeId !== "minecraft:water") {
        return true;
      }
    } catch (e) {
      continue;
    }
  }
  
  return false;
}

/**
 * Размещает паутину
 */
function placeWeb(dimension, pos, spiderId) {
  try {
    const block = dimension.getBlock(pos);
    if (!block || block.typeId !== "minecraft:air") return false;
    
    block.setPermutation(BlockPermutation.resolve("minecraft:web"));
    
    // Запоминаем для автоочистки
    placedWebs.push({
      position: { x: pos.x, y: pos.y, z: pos.z },
      placedTick: tickCounter,
      dimensionId: dimension.id
    });
    
    // Увеличиваем счётчик паука
    const currentCount = spiderWebCount.get(spiderId) || 0;
    spiderWebCount.set(spiderId, currentCount + 1);
    
    // Частицы
    if (CONFIG.PARTICLES_ON_PLACE) {
      dimension.runCommand(
        `particle minecraft:basic_smoke_particle ${pos.x} ${pos.y} ${pos.z}`
      );
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

// ============ ОСНОВНОЙ ЦИКЛ ============
system.runInterval(() => {
  tickCounter++;
  if (tickCounter % CONFIG.CHECK_INTERVAL !== 0) return;
  
  const overworld = world.getDimension("overworld");
  
  try {
    // Получаем пещерных пауков
    const entityType = CONFIG.ONLY_CAVE_SPIDERS ? "minecraft:cave_spider" : "minecraft:spider";
    const spiders = overworld.getEntities({ type: entityType });
    
    for (const spider of spiders) {
      // Шанс
      if (Math.random() > CONFIG.WEB_CHANCE) continue;
      
      const pos = spider.location;
      
      // Проверяем глубину (только пещеры)
      if (pos.y > CONFIG.WEB_BELOW_Y) continue;
      
      // Проверяем лимит паука
      const webCount = spiderWebCount.get(spider.id) || 0;
      if (webCount >= CONFIG.MAX_WEBS_PER_SPIDER) continue;
      
      // Проверяем темноту
      if (!isDarkEnough(overworld, pos)) continue;
      
      // Проверяем плотность паутин в области
      if (countWebsInArea(overworld, pos) >= CONFIG.MAX_WEBS_IN_AREA) continue;
      
      // Ищем позицию для паутины
      const webPos = findWebPosition(overworld, pos);
      if (!webPos) continue;
      
      // Ставим паутину
      placeWeb(overworld, webPos, spider.id);
    }
  } catch (e) {
    // Не критично
  }
}, 20);

// ============ АВТООЧИСТКА ПАУТИН ============
system.runInterval(() => {
  if (!CONFIG.CLEANUP_ENABLED) return;
  
  const now = tickCounter;
  const toRemove = [];
  
  for (let i = placedWebs.length - 1; i >= 0; i--) {
    const webData = placedWebs[i];
    
    if (now - webData.placedTick > CONFIG.WEB_LIFETIME_TICKS) {
      // Удаляем паутину
      try {
        const dimension = world.getDimension(webData.dimensionId || "overworld");
        const block = dimension.getBlock(webData.position);
        
        if (block && block.typeId === "minecraft:web") {
          block.setPermutation(BlockPermutation.resolve("minecraft:air"));
        }
      } catch (e) {
        // Блок мог быть уже удалён
      }
      
      toRemove.push(i);
    }
  }
  
  // Удаляем из массива (с конца)
  for (const idx of toRemove) {
    placedWebs.splice(idx, 1);
  }
}, 600); // Каждые 30 секунд
