import { world, system, BlockPermutation } from "@minecraft/server";

/**
 * ============================================================
 * ЖИТЕЛИ СТРОЯТ ДОМА - Расширенная система строительства
 * ============================================================
 * Жители периодически размещают блоки рядом с собой, постепенно "строя" структуры.
 * Система включает:
 * - Несколько стилей построек (дерево, камень, пустыня)
 * - Жители строят по "плану" (фундамент -> стены -> крыша)
 * - Прогресс строительства с этапами
 * - Жители-строители отмечены тегами
 * - Ограничение на количество построек рядом
 * - Уведомления о прогрессе
 * ============================================================
 */

// ============ НАСТРОЙКИ СИСТЕМЫ ============
const CONFIG = {
  BUILD_INTERVAL_TICKS: 200,        // Каждые 10 секунд
  BUILD_CHANCE: 0.20,               // 20% шанс за цикл
  MAX_BUILD_HEIGHT: 6,              // Максимальная высота
  BUILD_RADIUS: 5,                  // Радиус строительства
  MIN_VILLAGERS_NEARBY: 2,          // Минимум жителей для строительства
  MAX_BUILDINGS_PER_AREA: 3,        // Макс. построек в радиусе 20 блоков
  BUILDING_CHECK_RADIUS: 20,        // Радиус проверки плотности построек
  PARTICLES_ENABLED: true,          // Частицы при строительстве
  SOUND_ENABLED: true,              // Звуки при строительстве
  NOTIFY_PLAYERS: true,             // Уведомлять игроков о прогрессе
  NOTIFY_RADIUS: 24,               // Радиус уведомления
  MAX_BLOCKS_PER_BUILDING: 64,     // Максимум блоков в одной постройке
  NIGHT_BUILD_BONUS: 0.0,          // Жители не строят ночью (0% шанс бонус = нет)
  BIOME_ADAPTIVE: true,             // Адаптировать стиль к биому
  FOUNDATION_FIRST: true,           // Сначала строить фундамент
  CLEANUP_OLD_BUILDS: true          // Убирать незавершённые постройки
};

// ============ СТИЛИ ПОСТРОЕК ============
const BUILD_STYLES = {
  // Стандартный стиль (дубовая деревня)
  oak: {
    name: "Дубовый дом",
    foundation: ["minecraft:cobblestone", "minecraft:stone_bricks", "minecraft:mossy_cobblestone"],
    walls: ["minecraft:oak_planks", "minecraft:oak_log", "minecraft:stripped_oak_log"],
    windows: ["minecraft:glass", "minecraft:glass_pane"],
    roof: ["minecraft:oak_stairs", "minecraft:oak_slab", "minecraft:dark_oak_planks"],
    decor: ["minecraft:lantern", "minecraft:oak_fence", "minecraft:flower_pot", "minecraft:torch"],
    floor: ["minecraft:oak_planks", "minecraft:smooth_stone"]
  },
  // Каменный стиль
  stone: {
    name: "Каменный дом",
    foundation: ["minecraft:cobblestone", "minecraft:stone_bricks", "minecraft:andesite"],
    walls: ["minecraft:stone_bricks", "minecraft:polished_andesite", "minecraft:stone"],
    windows: ["minecraft:glass_pane", "minecraft:iron_bars"],
    roof: ["minecraft:stone_brick_stairs", "minecraft:stone_brick_slab", "minecraft:cobblestone_slab"],
    decor: ["minecraft:lantern", "minecraft:cobblestone_wall", "minecraft:torch"],
    floor: ["minecraft:stone_bricks", "minecraft:polished_andesite"]
  },
  // Пустынный стиль
  desert: {
    name: "Пустынный дом",
    foundation: ["minecraft:sandstone", "minecraft:smooth_sandstone", "minecraft:cut_sandstone"],
    walls: ["minecraft:sandstone", "minecraft:smooth_sandstone", "minecraft:cut_sandstone"],
    windows: ["minecraft:glass_pane", "minecraft:glass"],
    roof: ["minecraft:sandstone_stairs", "minecraft:sandstone_slab", "minecraft:orange_terracotta"],
    decor: ["minecraft:lantern", "minecraft:dead_bush", "minecraft:torch"],
    floor: ["minecraft:smooth_sandstone", "minecraft:cut_sandstone"]
  },
  // Тёмный дуб (тайга)
  dark_oak: {
    name: "Таёжный дом",
    foundation: ["minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:stone"],
    walls: ["minecraft:spruce_planks", "minecraft:spruce_log", "minecraft:stripped_spruce_log"],
    windows: ["minecraft:glass_pane", "minecraft:glass"],
    roof: ["minecraft:spruce_stairs", "minecraft:spruce_slab", "minecraft:dark_oak_planks"],
    decor: ["minecraft:lantern", "minecraft:spruce_fence", "minecraft:campfire", "minecraft:torch"],
    floor: ["minecraft:spruce_planks", "minecraft:cobblestone"]
  },
  // Берёзовый стиль
  birch: {
    name: "Берёзовый дом",
    foundation: ["minecraft:cobblestone", "minecraft:stone_bricks"],
    walls: ["minecraft:birch_planks", "minecraft:birch_log", "minecraft:stripped_birch_log"],
    windows: ["minecraft:glass_pane", "minecraft:glass"],
    roof: ["minecraft:birch_stairs", "minecraft:birch_slab", "minecraft:birch_planks"],
    decor: ["minecraft:lantern", "minecraft:birch_fence", "minecraft:torch", "minecraft:flower_pot"],
    floor: ["minecraft:birch_planks", "minecraft:smooth_stone"]
  }
};

// ============ ДАННЫЕ СТРОИТЕЛЬСТВА ============
const buildingProjects = new Map(); // buildingId -> { center, style, blocksPlaced, phase, startTick }
const villagerBuilders = new Map(); // villagerId -> { buildingId, assignedTick }

let tickCounter = 0;

// ============ ФАЗЫ СТРОИТЕЛЬСТВА ============
const BUILD_PHASES = {
  FOUNDATION: "foundation",   // Фундамент (y = 0)
  FLOOR: "floor",             // Пол (y = 1)
  WALLS: "walls",             // Стены (y = 1-4)
  WINDOWS: "windows",         // Окна в стенах
  ROOF: "roof",               // Крыша (y = 5-6)
  DECOR: "decor",             // Декор
  COMPLETE: "complete"        // Завершено
};

// ============ УТИЛИТЫ ============

/**
 * Выбирает случайный элемент из массива
 */
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Генерирует уникальный ID
 */
function generateId() {
  return `build_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/**
 * Определяет стиль постройки на основе окружения
 */
function detectBuildStyle(dimension, position) {
  if (!CONFIG.BIOME_ADAPTIVE) return randomChoice(Object.keys(BUILD_STYLES));

  // Проверяем блоки вокруг для определения "биома"
  try {
    let sandCount = 0;
    let grassCount = 0;
    let snowCount = 0;
    let darkCount = 0;

    for (let dx = -5; dx <= 5; dx += 2) {
      for (let dz = -5; dz <= 5; dz += 2) {
        const checkPos = {
          x: Math.floor(position.x) + dx,
          y: Math.floor(position.y) - 1,
          z: Math.floor(position.z) + dz
        };
        const block = dimension.getBlock(checkPos);
        if (!block) continue;

        if (block.typeId.includes("sand")) sandCount++;
        if (block.typeId.includes("grass") || block.typeId === "minecraft:dirt") grassCount++;
        if (block.typeId.includes("snow") || block.typeId.includes("ice")) snowCount++;
        if (block.typeId.includes("podzol") || block.typeId.includes("mycelium")) darkCount++;
      }
    }

    if (sandCount > 5) return "desert";
    if (snowCount > 3 || darkCount > 3) return "dark_oak";
    if (grassCount > 5) {
      // Случайный выбор между дубом и берёзой
      return Math.random() > 0.5 ? "oak" : "birch";
    }
  } catch (e) {
    // Ошибки не критичны
  }

  return randomChoice(Object.keys(BUILD_STYLES));
}

/**
 * Проверяет количество построек в радиусе
 */
function countBuildingsNearby(position) {
  let count = 0;
  for (const [, building] of buildingProjects) {
    const dx = building.center.x - position.x;
    const dz = building.center.z - position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < CONFIG.BUILDING_CHECK_RADIUS) {
      count++;
    }
  }
  return count;
}

/**
 * Определяет текущую фазу строительства
 */
function getCurrentPhase(blocksPlaced) {
  if (blocksPlaced < 9) return BUILD_PHASES.FOUNDATION;    // 3x3 фундамент
  if (blocksPlaced < 18) return BUILD_PHASES.FLOOR;        // Пол
  if (blocksPlaced < 42) return BUILD_PHASES.WALLS;        // Стены
  if (blocksPlaced < 50) return BUILD_PHASES.WINDOWS;      // Окна
  if (blocksPlaced < 60) return BUILD_PHASES.ROOF;         // Крыша
  if (blocksPlaced < CONFIG.MAX_BLOCKS_PER_BUILDING) return BUILD_PHASES.DECOR; // Декор
  return BUILD_PHASES.COMPLETE;
}

/**
 * Проверяет время суток (ночь = не строят)
 */
function isDaytime() {
  try {
    const time = world.getTimeOfDay();
    // День: 0-12000, Ночь: 12001-24000
    return time >= 0 && time <= 12000;
  } catch (e) {
    return true; // По умолчанию считаем что день
  }
}

/**
 * Находит или создаёт строительный проект для жителя
 */
function getOrCreateProject(dimension, villager) {
  const villagerId = villager.id;

  // Уже есть проект?
  if (villagerBuilders.has(villagerId)) {
    const assignedData = villagerBuilders.get(villagerId);
    if (buildingProjects.has(assignedData.buildingId)) {
      const project = buildingProjects.get(assignedData.buildingId);
      if (project.phase !== BUILD_PHASES.COMPLETE) {
        return { id: assignedData.buildingId, project };
      }
    }
    villagerBuilders.delete(villagerId);
  }

  // Ищем незавершённый проект рядом
  const villagerPos = villager.location;
  for (const [buildingId, project] of buildingProjects) {
    if (project.phase === BUILD_PHASES.COMPLETE) continue;

    const dx = project.center.x - villagerPos.x;
    const dz = project.center.z - villagerPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance < CONFIG.BUILD_RADIUS * 2) {
      villagerBuilders.set(villagerId, { buildingId, assignedTick: tickCounter });
      return { id: buildingId, project };
    }
  }

  // Проверяем плотность построек
  if (countBuildingsNearby(villagerPos) >= CONFIG.MAX_BUILDINGS_PER_AREA) {
    return null;
  }

  // Создаём новый проект
  const style = detectBuildStyle(dimension, villagerPos);
  const buildingId = generateId();
  const newProject = {
    center: {
      x: Math.floor(villagerPos.x) + Math.floor(Math.random() * 6) - 3,
      y: Math.floor(villagerPos.y),
      z: Math.floor(villagerPos.z) + Math.floor(Math.random() * 6) - 3
    },
    style: style,
    blocksPlaced: 0,
    phase: BUILD_PHASES.FOUNDATION,
    startTick: tickCounter,
    width: 3 + Math.floor(Math.random() * 2),  // 3-4 блока ширина
    depth: 3 + Math.floor(Math.random() * 2),  // 3-4 блока глубина
    height: 4 + Math.floor(Math.random() * 2)  // 4-5 блоков высота
  };

  buildingProjects.set(buildingId, newProject);
  villagerBuilders.set(villagerId, { buildingId, assignedTick: tickCounter });

  return { id: buildingId, project: newProject };
}

/**
 * Вычисляет позицию для следующего блока на основе фазы
 */
function getNextBuildPosition(project) {
  const phase = getCurrentPhase(project.blocksPlaced);
  project.phase = phase;

  const cx = project.center.x;
  const cy = project.center.y;
  const cz = project.center.z;
  const w = project.width;
  const d = project.depth;
  const h = project.height;

  switch (phase) {
    case BUILD_PHASES.FOUNDATION: {
      // Заполняем 3x3 или 4x4 на уровне земли
      const idx = project.blocksPlaced;
      const fx = idx % w;
      const fz = Math.floor(idx / w) % d;
      return { x: cx + fx, y: cy - 1, z: cz + fz };
    }

    case BUILD_PHASES.FLOOR: {
      // Пол внутри
      const idx = project.blocksPlaced - 9;
      const fx = idx % w;
      const fz = Math.floor(idx / w) % d;
      return { x: cx + fx, y: cy, z: cz + fz };
    }

    case BUILD_PHASES.WALLS: {
      // Стены по периметру
      const idx = project.blocksPlaced - 18;
      const wallHeight = Math.floor(idx / ((w + d) * 2 - 4)) + 1;
      const perimIdx = idx % ((w + d) * 2 - 4);

      let wx, wz;
      if (perimIdx < w) {
        wx = perimIdx; wz = 0;
      } else if (perimIdx < w + d - 1) {
        wx = w - 1; wz = perimIdx - w + 1;
      } else if (perimIdx < w * 2 + d - 2) {
        wx = w - 1 - (perimIdx - w - d + 2); wz = d - 1;
      } else {
        wx = 0; wz = d - 1 - (perimIdx - w * 2 - d + 3);
      }

      return { x: cx + wx, y: cy + wallHeight, z: cz + wz };
    }

    case BUILD_PHASES.WINDOWS: {
      // Окна на стенах (заменяем блоки стен)
      const windowY = cy + 2; // Окна на высоте 2
      const side = Math.floor(Math.random() * 4);
      let pos;
      switch (side) {
        case 0: pos = { x: cx + Math.floor(w / 2), y: windowY, z: cz }; break;
        case 1: pos = { x: cx + w - 1, y: windowY, z: cz + Math.floor(d / 2) }; break;
        case 2: pos = { x: cx + Math.floor(w / 2), y: windowY, z: cz + d - 1 }; break;
        default: pos = { x: cx, y: windowY, z: cz + Math.floor(d / 2) }; break;
      }
      return pos;
    }

    case BUILD_PHASES.ROOF: {
      // Крыша - заполняем сверху
      const idx = project.blocksPlaced - 50;
      const rx = idx % w;
      const rz = Math.floor(idx / w) % d;
      return { x: cx + rx, y: cy + h, z: cz + rz };
    }

    case BUILD_PHASES.DECOR: {
      // Декор - случайные позиции рядом
      return {
        x: cx + Math.floor(Math.random() * (w + 2)) - 1,
        y: cy,
        z: cz + Math.floor(Math.random() * (d + 2)) - 1
      };
    }

    default:
      return null;
  }
}

/**
 * Выбирает блок для текущей фазы
 */
function getBlockForPhase(project) {
  const phase = project.phase;
  const style = BUILD_STYLES[project.style] || BUILD_STYLES.oak;

  switch (phase) {
    case BUILD_PHASES.FOUNDATION:
      return randomChoice(style.foundation);
    case BUILD_PHASES.FLOOR:
      return randomChoice(style.floor);
    case BUILD_PHASES.WALLS:
      return randomChoice(style.walls);
    case BUILD_PHASES.WINDOWS:
      return randomChoice(style.windows);
    case BUILD_PHASES.ROOF:
      return randomChoice(style.roof);
    case BUILD_PHASES.DECOR:
      return randomChoice(style.decor);
    default:
      return randomChoice(style.walls);
  }
}

/**
 * Воспроизводит эффекты строительства
 */
function playBuildEffects(dimension, pos) {
  try {
    if (CONFIG.PARTICLES_ENABLED) {
      dimension.runCommand(
        `particle minecraft:crop_growth_emitter ${pos.x} ${pos.y} ${pos.z}`
      );
    }
    if (CONFIG.SOUND_ENABLED) {
      dimension.runCommand(
        `playsound use.wood ${pos.x} ${pos.y} ${pos.z} 0.5 1`
      );
    }
  } catch (e) {
    // Эффекты не критичны
  }
}

/**
 * Уведомляет игроков о прогрессе
 */
function notifyProgress(dimension, project, villagerPos) {
  if (!CONFIG.NOTIFY_PLAYERS) return;

  // Уведомляем только на важных этапах
  const milestones = [9, 18, 42, 50, 60]; // Завершение каждой фазы
  if (!milestones.includes(project.blocksPlaced)) return;

  try {
    const nearbyPlayers = dimension.getEntities({
      type: "minecraft:player",
      location: villagerPos,
      maxDistance: CONFIG.NOTIFY_RADIUS
    });

    const style = BUILD_STYLES[project.style] || BUILD_STYLES.oak;
    const phaseName = project.phase;
    const progress = Math.round((project.blocksPlaced / CONFIG.MAX_BLOCKS_PER_BUILDING) * 100);

    for (const player of nearbyPlayers) {
      player.sendMessage(
        `§e[Стройка] §fЖители строят "${style.name}" §7(${progress}% - ${phaseName})`
      );
    }
  } catch (e) {
    // Уведомления не критичны
  }
}

/**
 * Завершает проект и уведомляет
 */
function completeProject(dimension, project, villagerPos) {
  try {
    const nearbyPlayers = dimension.getEntities({
      type: "minecraft:player",
      location: villagerPos,
      maxDistance: CONFIG.NOTIFY_RADIUS
    });

    const style = BUILD_STYLES[project.style] || BUILD_STYLES.oak;
    for (const player of nearbyPlayers) {
      player.sendMessage(
        `§a[Стройка завершена!] §fЖители построили "${style.name}"! §7(${project.blocksPlaced} блоков)`
      );
    }
  } catch (e) {
    // Не критично
  }
}

// ============ ОСНОВНОЙ ЦИКЛ ============
system.runInterval(() => {
  tickCounter++;

  // Проверяем каждые BUILD_INTERVAL_TICKS
  if (tickCounter % CONFIG.BUILD_INTERVAL_TICKS !== 0) return;

  // Жители не строят ночью
  if (!isDaytime() && CONFIG.NIGHT_BUILD_BONUS <= 0) return;

  const overworld = world.getDimension("overworld");

  // Получаем всех жителей
  let villagers;
  try {
    villagers = overworld.getEntities({
      type: "minecraft:villager_v2"
    });
  } catch (e) {
    return;
  }

  for (const villager of villagers) {
    // Шанс строительства
    if (Math.random() > CONFIG.BUILD_CHANCE) continue;

    // Пропускаем детей
    const isBaby = villager.getComponent("minecraft:is_baby");
    if (isBaby) continue;

    const villagerPos = villager.location;

    // Проверяем есть ли рядом другие жители
    try {
      const nearbyVillagers = overworld.getEntities({
        type: "minecraft:villager_v2",
        location: villagerPos,
        maxDistance: 10
      });

      if (nearbyVillagers.length < CONFIG.MIN_VILLAGERS_NEARBY) continue;
    } catch (e) {
      continue;
    }

    // Получаем или создаём проект
    const projectData = getOrCreateProject(overworld, villager);
    if (!projectData) continue;

    const { project } = projectData;

    // Проект завершён?
    if (project.phase === BUILD_PHASES.COMPLETE) continue;
    if (project.blocksPlaced >= CONFIG.MAX_BLOCKS_PER_BUILDING) {
      project.phase = BUILD_PHASES.COMPLETE;
      completeProject(overworld, project, villagerPos);
      continue;
    }

    // Вычисляем позицию для блока
    const buildPos = getNextBuildPosition(project);
    if (!buildPos) continue;

    // Выбираем блок
    const blockType = getBlockForPhase(project);
    if (!blockType) continue;

    // Ставим блок
    try {
      const block = overworld.getBlock(buildPos);
      if (!block) continue;

      // Для стен и фундамента можно ставить на любой воздух
      // Для окон - заменяем стену
      if (project.phase === BUILD_PHASES.WINDOWS) {
        // Заменяем только существующие стены
        if (block.typeId !== "minecraft:air") {
          block.setPermutation(BlockPermutation.resolve(blockType));
          project.blocksPlaced++;
          playBuildEffects(overworld, buildPos);
        }
      } else {
        // Ставим только на воздух/траву
        const replaceable = [
          "minecraft:air", "minecraft:short_grass",
          "minecraft:tall_grass", "minecraft:fern",
          "minecraft:dead_bush", "minecraft:snow_layer"
        ];
        if (replaceable.includes(block.typeId)) {
          block.setPermutation(BlockPermutation.resolve(blockType));
          project.blocksPlaced++;
          playBuildEffects(overworld, buildPos);
          notifyProgress(overworld, project, villagerPos);
        }
      }

      // Помечаем жителя как строителя
      if (!villager.getTags().includes("builder")) {
        villager.addTag("builder");
      }
    } catch (e) {
      // Блок вне загруженных чанков или другая ошибка
    }
  }
}, 20);

// ============ ОЧИСТКА СТАРЫХ ПРОЕКТОВ ============
system.runInterval(() => {
  if (!CONFIG.CLEANUP_OLD_BUILDS) return;

  const maxAge = 72000; // ~1 час реального времени

  for (const [buildingId, project] of buildingProjects) {
    if (project.phase === BUILD_PHASES.COMPLETE) {
      // Удаляем завершённые через 5 минут
      if (tickCounter - project.startTick > 6000) {
        buildingProjects.delete(buildingId);
      }
    } else if (tickCounter - project.startTick > maxAge) {
      // Удаляем слишком старые незавершённые
      buildingProjects.delete(buildingId);
    }
  }
}, 1200); // Каждую минуту
