import { world, system } from "@minecraft/server";

/**
 * ============================================================
 * СИДЕТЬ НА СТУПЕНЬКАХ
 * ============================================================
 * Игрок может сесть на ступеньку нажав ПКМ без предмета в руке.
 * Реализация: при взаимодействии со ступенькой (пустая рука)
 * телепортируем игрока на ступеньку и даём замедление.
 * При движении, прыжке или ломании ступеньки — встаёт.
 * ============================================================
 */

// ============ НАСТРОЙКИ ============
const CONFIG = {
  CHECK_INTERVAL: 10,               // Проверка каждые 0.5 сек
  SIT_HEIGHT_OFFSET: 0.3,          // Смещение вниз при сидении
  STAND_UP_ON_MOVE: true,          // Встать при движении
  STAND_UP_ON_JUMP: true,          // Встать при прыжке
  STAND_UP_ON_SNEAK: true,         // Встать при шифте
  STAND_UP_ON_BLOCK_BREAK: true,   // Встать при ломании ступеньки
  PARTICLES_ON_SIT: true,          // Частицы при посадке
  NOTIFY_ON_SIT: true,             // Сообщение при посадке
  MOVE_THRESHOLD: 0.3              // Порог движения для вставания
};

// Все блоки ступенек
const STAIR_BLOCKS = [
  "minecraft:oak_stairs",
  "minecraft:birch_stairs",
  "minecraft:spruce_stairs",
  "minecraft:dark_oak_stairs",
  "minecraft:jungle_stairs",
  "minecraft:acacia_stairs",
  "minecraft:mangrove_stairs",
  "minecraft:cherry_stairs",
  "minecraft:bamboo_stairs",
  "minecraft:crimson_stairs",
  "minecraft:warped_stairs",
  "minecraft:stone_stairs",
  "minecraft:cobblestone_stairs",
  "minecraft:stone_brick_stairs",
  "minecraft:mossy_stone_brick_stairs",
  "minecraft:mossy_cobblestone_stairs",
  "minecraft:sandstone_stairs",
  "minecraft:smooth_sandstone_stairs",
  "minecraft:red_sandstone_stairs",
  "minecraft:smooth_red_sandstone_stairs",
  "minecraft:brick_stairs",
  "minecraft:nether_brick_stairs",
  "minecraft:red_nether_brick_stairs",
  "minecraft:quartz_stairs",
  "minecraft:smooth_quartz_stairs",
  "minecraft:purpur_stairs",
  "minecraft:prismarine_stairs",
  "minecraft:dark_prismarine_stairs",
  "minecraft:prismarine_brick_stairs",
  "minecraft:granite_stairs",
  "minecraft:polished_granite_stairs",
  "minecraft:diorite_stairs",
  "minecraft:polished_diorite_stairs",
  "minecraft:andesite_stairs",
  "minecraft:polished_andesite_stairs",
  "minecraft:end_stone_brick_stairs",
  "minecraft:blackstone_stairs",
  "minecraft:polished_blackstone_stairs",
  "minecraft:polished_blackstone_brick_stairs",
  "minecraft:cut_copper_stairs",
  "minecraft:exposed_cut_copper_stairs",
  "minecraft:weathered_cut_copper_stairs",
  "minecraft:oxidized_cut_copper_stairs",
  "minecraft:waxed_cut_copper_stairs",
  "minecraft:waxed_exposed_cut_copper_stairs",
  "minecraft:waxed_weathered_cut_copper_stairs",
  "minecraft:waxed_oxidized_cut_copper_stairs",
  "minecraft:cobbled_deepslate_stairs",
  "minecraft:polished_deepslate_stairs",
  "minecraft:deepslate_brick_stairs",
  "minecraft:deepslate_tile_stairs",
  "minecraft:mud_brick_stairs"
];

// ============ ДАННЫЕ ============
// Хранение сидящих игроков
const sittingPlayers = new Map(); // playerId -> { position, stairPos, seatEntityId }

let tickCounter = 0;

// ============ УТИЛИТЫ ============

/**
 * Проверяет является ли блок ступенькой
 */
function isStairBlock(blockTypeId) {
  return STAIR_BLOCKS.includes(blockTypeId) || blockTypeId.includes("stairs");
}

/**
 * Проверяет пустая ли рука у игрока
 */
function isHandEmpty(player) {
  try {
    const equipment = player.getComponent("minecraft:equippable");
    if (!equipment) return true;
    const mainhand = equipment.getEquipment("Mainhand");
    return !mainhand;
  } catch (e) {
    return true;
  }
}

/**
 * Сажает игрока на ступеньку
 */
function sitDown(player, stairPos) {
  const playerId = player.id;

  // Уже сидит?
  if (sittingPlayers.has(playerId)) return;

  try {
    const dimension = player.dimension;
    const sitPos = {
      x: stairPos.x + 0.5,
      y: stairPos.y + CONFIG.SIT_HEIGHT_OFFSET,
      z: stairPos.z + 0.5
    };

    // Спавним невидимую сущность для "сидения" (используем armor_stand)
    // Нет, лучше просто телепортируем и добавляем эффект
    player.teleport(sitPos, {
      dimension: dimension,
      facingLocation: {
        x: sitPos.x + player.getViewDirection().x,
        y: sitPos.y,
        z: sitPos.z + player.getViewDirection().z
      }
    });

    // Даём замедление чтобы не двигался
    dimension.runCommand(
      `effect "${player.name}" slowness 99999 255 true`
    );
    // Даём mining fatigue чтобы не ломал
    dimension.runCommand(
      `effect "${player.name}" mining_fatigue 99999 255 true`
    );

    // Сохраняем данные
    sittingPlayers.set(playerId, {
      position: { x: sitPos.x, y: sitPos.y, z: sitPos.z },
      stairPos: { x: stairPos.x, y: stairPos.y, z: stairPos.z },
      sitTick: tickCounter
    });

    // Тег
    player.addTag("sitting");

    // Эффекты
    if (CONFIG.PARTICLES_ON_SIT) {
      dimension.runCommand(
        `particle minecraft:crop_growth_emitter ${sitPos.x} ${sitPos.y} ${sitPos.z}`
      );
    }

    if (CONFIG.NOTIFY_ON_SIT) {
      player.sendMessage("§7Вы сели. Присядьте (Shift) или двигайтесь чтобы встать.");
    }
  } catch (e) {
    // Не удалось посадить
  }
}

/**
 * Поднимает игрока со ступеньки
 */
function standUp(player, reason) {
  const playerId = player.id;

  if (!sittingPlayers.has(playerId)) return;

  const sitData = sittingPlayers.get(playerId);
  sittingPlayers.delete(playerId);

  try {
    const dimension = player.dimension;

    // Убираем эффекты
    dimension.runCommand(`effect "${player.name}" slowness 0`);
    dimension.runCommand(`effect "${player.name}" mining_fatigue 0`);

    // Телепортируем чуть выше (встаём)
    player.teleport({
      x: sitData.stairPos.x + 0.5,
      y: sitData.stairPos.y + 1,
      z: sitData.stairPos.z + 0.5
    }, { dimension: dimension });

    // Убираем тег
    player.removeTag("sitting");

    if (CONFIG.NOTIFY_ON_SIT) {
      player.sendMessage(`§7Вы встали. §8(${reason})`);
    }
  } catch (e) {
    // Пробуем хотя бы убрать эффекты
    try {
      player.dimension.runCommand(`effect "${player.name}" slowness 0`);
      player.dimension.runCommand(`effect "${player.name}" mining_fatigue 0`);
      player.removeTag("sitting");
    } catch (e2) {
      // Совсем не критично
    }
  }
}

// ============ СОБЫТИЕ ВЗАИМОДЕЙСТВИЯ С БЛОКОМ ============
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const player = event.player;
  const block = event.block;

  // Проверяем что это ступенька
  if (!isStairBlock(block.typeId)) return;

  // Проверяем пустая ли рука
  if (!isHandEmpty(player)) return;

  // Проверяем не сидит ли уже
  if (sittingPlayers.has(player.id)) return;

  // Проверяем что блок сверху свободен (есть место сесть)
  try {
    const aboveBlock = player.dimension.getBlock({
      x: block.location.x,
      y: block.location.y + 1,
      z: block.location.z
    });
    if (aboveBlock && aboveBlock.typeId !== "minecraft:air") return;
  } catch (e) {
    return;
  }

  // Садимся!
  system.run(() => {
    sitDown(player, block.location);
  });
});

// ============ ПРОВЕРКА ВСТАВАНИЯ ============
system.runInterval(() => {
  tickCounter++;
  if (tickCounter % CONFIG.CHECK_INTERVAL !== 0) return;

  for (const [playerId, sitData] of sittingPlayers) {
    try {
      // Ищем игрока
      const players = world.getAllPlayers();
      const player = players.find(p => p.id === playerId);

      if (!player) {
        // Игрок вышел
        sittingPlayers.delete(playerId);
        continue;
      }

      // Проверка: игрок двигается?
      if (CONFIG.STAND_UP_ON_MOVE) {
        const currentPos = player.location;
        const dx = Math.abs(currentPos.x - sitData.position.x);
        const dz = Math.abs(currentPos.z - sitData.position.z);

        if (dx > CONFIG.MOVE_THRESHOLD || dz > CONFIG.MOVE_THRESHOLD) {
          standUp(player, "движение");
          continue;
        }
      }

      // Проверка: игрок крадётся?
      if (CONFIG.STAND_UP_ON_SNEAK && player.isSneaking) {
        standUp(player, "Shift");
        continue;
      }

      // Проверка: игрок прыгает? (выше позиции сидения)
      if (CONFIG.STAND_UP_ON_JUMP) {
        const currentY = player.location.y;
        if (currentY > sitData.position.y + 0.5) {
          standUp(player, "прыжок");
          continue;
        }
      }

      // Проверка: ступенька сломана?
      if (CONFIG.STAND_UP_ON_BLOCK_BREAK) {
        const dimension = player.dimension;
        const stairBlock = dimension.getBlock(sitData.stairPos);
        if (!stairBlock || !isStairBlock(stairBlock.typeId)) {
          standUp(player, "ступенька сломана");
          continue;
        }
      }

      // Подтелепортируем обратно (чтобы не "сползал")
      player.teleport(sitData.position, { dimension: player.dimension });

    } catch (e) {
      // Если ошибка — встаём
      sittingPlayers.delete(playerId);
    }
  }
}, 5);

// ============ ВСТАВАНИЕ ПРИ ПОЛУЧЕНИИ УРОНА ============
world.afterEvents.entityHurt.subscribe((event) => {
  const entity = event.hurtEntity;
  if (entity.typeId !== "minecraft:player") return;

  if (sittingPlayers.has(entity.id)) {
    system.run(() => {
      standUp(entity, "урон");
    });
  }
});
