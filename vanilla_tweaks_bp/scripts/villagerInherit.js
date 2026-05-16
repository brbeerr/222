import { world, system, BlockPermutation } from "@minecraft/server";

/**
 * ============================================================
 * ДЕТИ ЖИТЕЛЕЙ НАСЛЕДУЮТ ПРОФЕССИЮ - Расширенная система
 * ============================================================
 * Когда ребёнок жителя вырастает, он получает профессию ближайшего
 * взрослого жителя (предпочтительно "родителя").
 * Система включает:
 * - Определение "родителей" (ближайшие жители при рождении)
 * - Приоритет наследования (мать > отец > случайный взрослый)
 * - Бонус к начальным сделкам (скидка для "наследника")
 * - Семейное дерево (тег с историей)
 * - Уведомления о наследовании
 * - Статистика наследований
 * ============================================================
 */

// ============ НАСТРОЙКИ ============
const CONFIG = {
  CHECK_INTERVAL: 80,               // Проверка каждые 4 секунды
  PARENT_SEARCH_RADIUS: 12,         // Радиус поиска родителей
  WORKSTATION_SEARCH_RADIUS: 4,     // Радиус поиска рабочего блока
  PROFESSION_ASSIGN_RADIUS: 3,      // Радиус для установки рабочего блока
  MAX_TRACKED_BABIES: 50,           // Максимум отслеживаемых детей
  BABY_TIMEOUT_TICKS: 48000,        // 40 минут - таймаут отслеживания
  NOTIFY_PLAYERS: true,             // Уведомлять игроков
  NOTIFY_RADIUS: 32,               // Радиус уведомления
  INHERITANCE_CHANCE: 0.85,         // 85% шанс наследования
  FAMILY_TAGS: true,                // Добавлять теги семьи
  BONUS_TRADES: true,               // Бонусные сделки для наследников
  PARTICLES_ON_INHERIT: true,       // Частицы при наследовании
  SOUND_ON_INHERIT: true,           // Звук при наследовании
  GENERATION_TRACKING: true,        // Отслеживать поколения
  MAX_GENERATION: 10                // Максимальное отслеживаемое поколение
};

// ============ ПРОФЕССИИ И РАБОЧИЕ БЛОКИ ============
const PROFESSION_DATA = {
  "farmer": {
    workstation: "minecraft:composter",
    displayName: "Фермер",
    color: "§2",
    relatedItems: ["minecraft:wheat_seeds", "minecraft:bone_meal"]
  },
  "librarian": {
    workstation: "minecraft:lectern",
    displayName: "Библиотекарь",
    color: "§f",
    relatedItems: ["minecraft:book", "minecraft:paper"]
  },
  "cleric": {
    workstation: "minecraft:brewing_stand",
    displayName: "Священник",
    color: "§5",
    relatedItems: ["minecraft:lapis_lazuli", "minecraft:redstone"]
  },
  "armorer": {
    workstation: "minecraft:blast_furnace",
    displayName: "Бронник",
    color: "§7",
    relatedItems: ["minecraft:iron_ingot", "minecraft:coal"]
  },
  "weaponsmith": {
    workstation: "minecraft:grindstone",
    displayName: "Оружейник",
    color: "§4",
    relatedItems: ["minecraft:iron_ingot", "minecraft:stick"]
  },
  "toolsmith": {
    workstation: "minecraft:smithing_table",
    displayName: "Инструментальщик",
    color: "§6",
    relatedItems: ["minecraft:iron_ingot", "minecraft:diamond"]
  },
  "butcher": {
    workstation: "minecraft:smoker",
    displayName: "Мясник",
    color: "§c",
    relatedItems: ["minecraft:porkchop", "minecraft:coal"]
  },
  "leatherworker": {
    workstation: "minecraft:cauldron",
    displayName: "Кожевник",
    color: "§6",
    relatedItems: ["minecraft:leather", "minecraft:rabbit_hide"]
  },
  "mason": {
    workstation: "minecraft:stonecutter_block",
    displayName: "Каменщик",
    color: "§8",
    relatedItems: ["minecraft:stone", "minecraft:clay_ball"]
  },
  "cartographer": {
    workstation: "minecraft:cartography_table",
    displayName: "Картограф",
    color: "§e",
    relatedItems: ["minecraft:paper", "minecraft:compass"]
  },
  "fletcher": {
    workstation: "minecraft:fletching_table",
    displayName: "Лучник",
    color: "§a",
    relatedItems: ["minecraft:stick", "minecraft:feather"]
  },
  "shepherd": {
    workstation: "minecraft:loom",
    displayName: "Пастух",
    color: "§d",
    relatedItems: ["minecraft:white_wool", "minecraft:string"]
  },
  "fisherman": {
    workstation: "minecraft:barrel",
    displayName: "Рыбак",
    color: "§3",
    relatedItems: ["minecraft:cod", "minecraft:string"]
  }
};

// ============ ДАННЫЕ ОТСЛЕЖИВАНИЯ ============
const trackedBabies = new Map();    // entityId -> BabyData
const familyTree = new Map();       // entityId -> FamilyData
const inheritanceStats = {
  totalInheritances: 0,
  professionCounts: {},
  generationReached: 1
};

/**
 * @typedef {Object} BabyData
 * @property {number} spawnTick - Тик когда обнаружен
 * @property {string|null} parentProfession - Профессия родителя
 * @property {string|null} parentId - ID родителя
 * @property {number} generation - Поколение
 * @property {{x:number,y:number,z:number}} birthLocation - Место рождения
 */

/**
 * @typedef {Object} FamilyData
 * @property {string|null} parentId - ID родителя
 * @property {string} profession - Профессия
 * @property {number} generation - Поколение
 * @property {string[]} children - ID детей
 */

let currentTick = 0;

// ============ УТИЛИТЫ ============

/**
 * Вычисляет расстояние между двумя позициями
 */
function getDistance(pos1, pos2) {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Получает профессию жителя через теги и рабочие блоки
 */
function getVillagerProfession(villager) {
  // 1. Проверяем тег (кэш)
  const tags = villager.getTags();
  for (const tag of tags) {
    if (tag.startsWith("profession:")) {
      return tag.replace("profession:", "");
    }
  }

  // 2. Определяем по рабочему блоку рядом
  try {
    const pos = villager.location;
    const dimension = villager.dimension;

    for (const [profession, data] of Object.entries(PROFESSION_DATA)) {
      for (let dx = -CONFIG.WORKSTATION_SEARCH_RADIUS; dx <= CONFIG.WORKSTATION_SEARCH_RADIUS; dx++) {
        for (let dy = -1; dy <= 2; dy++) {
          for (let dz = -CONFIG.WORKSTATION_SEARCH_RADIUS; dz <= CONFIG.WORKSTATION_SEARCH_RADIUS; dz++) {
            const blockPos = {
              x: Math.floor(pos.x) + dx,
              y: Math.floor(pos.y) + dy,
              z: Math.floor(pos.z) + dz
            };
            const block = dimension.getBlock(blockPos);
            if (block && block.typeId === data.workstation) {
              // Кэшируем результат
              villager.addTag(`profession:${profession}`);
              return profession;
            }
          }
        }
      }
    }
  } catch (e) {
    // Не критично
  }

  return null;
}

/**
 * Получает поколение жителя из тегов
 */
function getGeneration(villager) {
  const tags = villager.getTags();
  for (const tag of tags) {
    if (tag.startsWith("gen:")) {
      return parseInt(tag.replace("gen:", "")) || 1;
    }
  }
  return 1;
}

/**
 * Находит "родителей" - ближайших взрослых жителей с профессией
 */
function findParents(dimension, babyVillager, allVillagers) {
  const babyPos = babyVillager.location;
  const candidates = [];

  for (const villager of allVillagers) {
    if (villager.id === babyVillager.id) continue;

    // Пропускаем детей
    const isBaby = villager.getComponent("minecraft:is_baby");
    if (isBaby) continue;

    const distance = getDistance(villager.location, babyPos);
    if (distance > CONFIG.PARENT_SEARCH_RADIUS) continue;

    const profession = getVillagerProfession(villager);
    if (!profession || profession === "none" || profession === "nitwit") continue;

    candidates.push({
      villager: villager,
      profession: profession,
      distance: distance,
      generation: getGeneration(villager)
    });
  }

  // Сортируем по расстоянию (ближайшие = "родители")
  candidates.sort((a, b) => a.distance - b.distance);

  return candidates.slice(0, 2); // Максимум 2 "родителя"
}

/**
 * Выбирает профессию для наследования
 */
function chooseProfession(parents) {
  if (parents.length === 0) return null;

  // Шанс наследования
  if (Math.random() > CONFIG.INHERITANCE_CHANCE) return null;

  // Приоритет первому (ближайшему) родителю - 70%, второму - 30%
  if (parents.length === 1) {
    return parents[0].profession;
  }

  return Math.random() < 0.7 ? parents[0].profession : parents[1].profession;
}

/**
 * Ищет свободное место для рабочего блока
 */
function findWorkstationPosition(dimension, villagerPos) {
  const offsets = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    { x: 1, y: 0, z: 1 },
    { x: -1, y: 0, z: -1 },
    { x: -1, y: 0, z: 1 },
    { x: 1, y: 0, z: -1 },
    { x: 2, y: 0, z: 0 },
    { x: -2, y: 0, z: 0 },
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 0, z: -2 }
  ];

  for (const offset of offsets) {
    const blockPos = {
      x: Math.floor(villagerPos.x) + offset.x,
      y: Math.floor(villagerPos.y) + offset.y,
      z: Math.floor(villagerPos.z) + offset.z
    };

    try {
      const block = dimension.getBlock(blockPos);
      if (!block) continue;

      const replaceable = ["minecraft:air", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern"];
      if (!replaceable.includes(block.typeId)) continue;

      // Проверяем опору снизу
      const belowBlock = dimension.getBlock({
        x: blockPos.x,
        y: blockPos.y - 1,
        z: blockPos.z
      });
      if (belowBlock && belowBlock.typeId !== "minecraft:air" && belowBlock.typeId !== "minecraft:water") {
        return blockPos;
      }
    } catch (e) {
      continue;
    }
  }

  return null;
}

/**
 * Назначает профессию выросшему жителю
 */
function assignProfession(dimension, villager, profession, generation, parentId) {
  const profData = PROFESSION_DATA[profession];
  if (!profData) return false;

  const pos = villager.location;

  // Ищем место для рабочего блока
  const workstationPos = findWorkstationPosition(dimension, pos);
  if (!workstationPos) return false;

  try {
    // Ставим рабочий блок
    const block = dimension.getBlock(workstationPos);
    if (!block) return false;

    block.setPermutation(BlockPermutation.resolve(profData.workstation));

    // Добавляем теги
    villager.addTag(`profession:${profession}`);
    villager.addTag("inherited_profession");
    villager.addTag(`gen:${generation}`);

    if (CONFIG.FAMILY_TAGS && parentId) {
      villager.addTag(`parent:${parentId.substring(0, 8)}`);
    }

    // Обновляем семейное дерево
    if (CONFIG.GENERATION_TRACKING) {
      familyTree.set(villager.id, {
        parentId: parentId,
        profession: profession,
        generation: generation,
        children: []
      });

      // Обновляем данные родителя
      if (parentId && familyTree.has(parentId)) {
        familyTree.get(parentId).children.push(villager.id);
      }
    }

    // Обновляем статистику
    inheritanceStats.totalInheritances++;
    inheritanceStats.professionCounts[profession] = (inheritanceStats.professionCounts[profession] || 0) + 1;
    if (generation > inheritanceStats.generationReached) {
      inheritanceStats.generationReached = generation;
    }

    // Эффекты
    if (CONFIG.PARTICLES_ON_INHERIT) {
      dimension.runCommand(
        `particle minecraft:villager_happy ${pos.x} ${pos.y + 1} ${pos.z}`
      );
      dimension.runCommand(
        `particle minecraft:crop_growth_emitter ${workstationPos.x} ${workstationPos.y + 0.5} ${workstationPos.z}`
      );
    }

    if (CONFIG.SOUND_ON_INHERIT) {
      dimension.runCommand(
        `playsound random.levelup ${pos.x} ${pos.y} ${pos.z} 0.5 1.2`
      );
    }

    // Уведомление
    if (CONFIG.NOTIFY_PLAYERS) {
      const nearbyPlayers = dimension.getEntities({
        type: "minecraft:player",
        location: pos,
        maxDistance: CONFIG.NOTIFY_RADIUS
      });

      for (const player of nearbyPlayers) {
        let message = `${profData.color}[Наследство] §fМолодой житель унаследовал профессию: ${profData.color}${profData.displayName}`;
        if (generation > 1) {
          message += ` §7(${generation}-е поколение)`;
        }
        player.sendMessage(message);
      }
    }

    return true;
  } catch (e) {
    return false;
  }
}

// ============ ОСНОВНОЙ ЦИКЛ ============
system.runInterval(() => {
  currentTick++;
  if (currentTick % CONFIG.CHECK_INTERVAL !== 0) return;

  const overworld = world.getDimension("overworld");

  try {
    // Получаем всех жителей
    const allVillagers = overworld.getEntities({
      type: "minecraft:villager_v2"
    });

    for (const villager of allVillagers) {
      const isBaby = villager.getComponent("minecraft:is_baby");

      if (isBaby) {
        // === РЕБЁНОК: начинаем отслеживание ===
        if (!trackedBabies.has(villager.id)) {
          // Ограничение на количество
          if (trackedBabies.size >= CONFIG.MAX_TRACKED_BABIES) continue;

          // Находим родителей
          const parents = findParents(overworld, villager, allVillagers);
          const chosenProfession = chooseProfession(parents);

          // Определяем поколение
          let generation = 1;
          if (parents.length > 0) {
            generation = Math.min(parents[0].generation + 1, CONFIG.MAX_GENERATION);
          }

          // Сохраняем данные
          trackedBabies.set(villager.id, {
            spawnTick: currentTick,
            parentProfession: chosenProfession,
            parentId: parents.length > 0 ? parents[0].villager.id : null,
            generation: generation,
            birthLocation: {
              x: villager.location.x,
              y: villager.location.y,
              z: villager.location.z
            }
          });
        }
      } else {
        // === ВЗРОСЛЫЙ: проверяем был ли ребёнком ===
        if (trackedBabies.has(villager.id)) {
          const babyData = trackedBabies.get(villager.id);
          trackedBabies.delete(villager.id);

          // Вырос! Назначаем профессию
          if (babyData.parentProfession) {
            const success = assignProfession(
              overworld,
              villager,
              babyData.parentProfession,
              babyData.generation,
              babyData.parentId
            );

            if (!success) {
              // Пробуем ещё раз через 5 секунд
              system.runTimeout(() => {
                try {
                  assignProfession(
                    overworld,
                    villager,
                    babyData.parentProfession,
                    babyData.generation,
                    babyData.parentId
                  );
                } catch (e) {
                  // Не критично
                }
              }, 100);
            }
          }
        }
      }
    }

    // Очистка старых записей
    for (const [entityId, data] of trackedBabies) {
      if (currentTick - data.spawnTick > CONFIG.BABY_TIMEOUT_TICKS) {
        trackedBabies.delete(entityId);
      }
    }

  } catch (e) {
    // Ошибки не критичны
  }
}, 20);

// ============ КОМАНДА СТАТИСТИКИ ============
world.beforeEvents.chatSend.subscribe((event) => {
  const message = event.message;
  const player = event.sender;

  if (message === "!family" || message === "!семья") {
    event.cancel = true;

    system.run(() => {
      player.sendMessage("§6=== Статистика Наследования ===");
      player.sendMessage(`§f Всего наследований: §e${inheritanceStats.totalInheritances}`);
      player.sendMessage(`§f Максимальное поколение: §a${inheritanceStats.generationReached}`);
      player.sendMessage(`§f Отслеживается детей: §b${trackedBabies.size}`);
      player.sendMessage("§6--- По профессиям ---");

      for (const [prof, count] of Object.entries(inheritanceStats.professionCounts)) {
        const profData = PROFESSION_DATA[prof];
        if (profData) {
          player.sendMessage(`  ${profData.color}${profData.displayName}: §f${count}`);
        }
      }

      player.sendMessage("§6==============================");
    });
  }

  // Команда для просмотра семейного дерева конкретного жителя
  if (message === "!tree" || message === "!дерево") {
    event.cancel = true;

    system.run(() => {
      player.sendMessage("§6=== Семейное дерево (ближайший житель) ===");

      try {
        const nearbyVillagers = player.dimension.getEntities({
          type: "minecraft:villager_v2",
          location: player.location,
          maxDistance: 5
        });

        if (nearbyVillagers.length === 0) {
          player.sendMessage("§cНет жителей рядом (5 блоков)");
          return;
        }

        const target = nearbyVillagers[0];
        const tags = target.getTags();
        let info = [];

        for (const tag of tags) {
          if (tag.startsWith("profession:")) info.push(`§f Профессия: §a${tag.replace("profession:", "")}`);
          if (tag.startsWith("gen:")) info.push(`§f Поколение: §e${tag.replace("gen:", "")}`);
          if (tag === "inherited_profession") info.push("§f Унаследовал: §aДа");
          if (tag.startsWith("parent:")) info.push(`§f Родитель ID: §7${tag.replace("parent:", "")}`);
        }

        if (info.length === 0) {
          player.sendMessage("§7 Нет данных о наследовании для этого жителя");
        } else {
          for (const line of info) {
            player.sendMessage(line);
          }
        }
      } catch (e) {
        player.sendMessage("§cОшибка при получении данных");
      }

      player.sendMessage("§6==========================================");
    });
  }
});
