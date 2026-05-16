import { world, system, ItemStack, EntityComponentTypes, EquipmentSlot } from "@minecraft/server";

/**
 * ============================================================
 * УДАЧА НА МОБАХ - Расширенная система лута
 * ============================================================
 * Когда игрок убивает моба оружием с зачарованием "Удача" (Fortune),
 * моб дропает дополнительный лут. Система включает:
 * - Расширенную таблицу лута для всех мобов
 * - Систему комбо (убийства подряд увеличивают множитель)
 * - Редкие дропы с уникальными шансами
 * - Статистику для игрока
 * - Визуальные эффекты при особом луте
 * ============================================================
 */

// ============ НАСТРОЙКИ СИСТЕМЫ ============
const CONFIG = {
  BASE_CHANCE_PER_LEVEL: 0.30,       // 30% шанс за уровень удачи (обычный лут)
  RARE_CHANCE_PER_LEVEL: 0.15,       // 15% шанс за уровень удачи (редкий лут)
  EPIC_CHANCE_PER_LEVEL: 0.05,       // 5% шанс за уровень удачи (эпический лут)
  COMBO_TIMEOUT_TICKS: 100,          // 5 секунд для продолжения комбо
  COMBO_BONUS_PER_KILL: 0.05,        // +5% бонус за каждое убийство в комбо
  MAX_COMBO_BONUS: 0.50,             // Максимальный бонус от комбо (50%)
  SHOW_MESSAGES_MIN_LEVEL: 1,        // Минимальный уровень для сообщений
  PARTICLE_ON_RARE: true,            // Частицы при редком дропе
  SOUND_ON_EPIC: true,               // Звук при эпическом дропе
  STATS_ENABLED: true,               // Включить статистику
  NOTIFY_RADIUS: 16                  // Радиус оповещения о редком луте
};

// ============ ТАБЛИЦА ЛУТА ============
const MOB_LOOT_TABLE = {
  // --- Враждебные мобы ---
  "minecraft:zombie": [
    { item: "minecraft:rotten_flesh", min: 1, max: 3, tier: "common" },
    { item: "minecraft:iron_ingot", min: 1, max: 1, tier: "rare" },
    { item: "minecraft:iron_sword", min: 1, max: 1, tier: "epic" },
    { item: "minecraft:potato", min: 1, max: 2, tier: "common" }
  ],
  "minecraft:skeleton": [
    { item: "minecraft:bone", min: 1, max: 4, tier: "common" },
    { item: "minecraft:arrow", min: 2, max: 5, tier: "common" },
    { item: "minecraft:bow", min: 1, max: 1, tier: "rare" },
    { item: "minecraft:bone_block", min: 1, max: 1, tier: "epic" }
  ],
  "minecraft:creeper": [
    { item: "minecraft:gunpowder", min: 1, max: 4, tier: "common" },
    { item: "minecraft:tnt", min: 1, max: 1, tier: "rare" },
    { item: "minecraft:firework_rocket", min: 1, max: 3, tier: "rare" }
  ],
  "minecraft:spider": [
    { item: "minecraft:string", min: 1, max: 4, tier: "common" },
    { item: "minecraft:spider_eye", min: 1, max: 2, tier: "common" },
    { item: "minecraft:fermented_spider_eye", min: 1, max: 1, tier: "rare" }
  ],
  "minecraft:cave_spider": [
    { item: "minecraft:string", min: 1, max: 3, tier: "common" },
    { item: "minecraft:spider_eye", min: 1, max: 2, tier: "common" },
    { item: "minecraft:fermented_spider_eye", min: 1, max: 2, tier: "rare" },
    { item: "minecraft:poisonous_potato", min: 1, max: 1, tier: "epic" }
  ],
  "minecraft:enderman": [
    { item: "minecraft:ender_pearl", min: 1, max: 3, tier: "common" },
    { item: "minecraft:chorus_fruit", min: 1, max: 2, tier: "rare" },
    { item: "minecraft:end_stone", min: 1, max: 4, tier: "rare" }
  ],
  "minecraft:blaze": [
    { item: "minecraft:blaze_rod", min: 1, max: 3, tier: "common" },
    { item: "minecraft:blaze_powder", min: 1, max: 2, tier: "common" },
    { item: "minecraft:fire_charge", min: 1, max: 3, tier: "rare" }
  ],
  "minecraft:wither_skeleton": [
    { item: "minecraft:coal", min: 1, max: 3, tier: "common" },
    { item: "minecraft:bone", min: 1, max: 3, tier: "common" },
    { item: "minecraft:wither_skeleton_skull", min: 1, max: 1, tier: "epic" }
  ],
  "minecraft:phantom": [
    { item: "minecraft:phantom_membrane", min: 1, max: 3, tier: "common" },
    { item: "minecraft:elytra", min: 1, max: 1, tier: "epic" }
  ],
  "minecraft:drowned": [
    { item: "minecraft:rotten_flesh", min: 1, max: 3, tier: "common" },
    { item: "minecraft:copper_ingot", min: 1, max: 2, tier: "common" },
    { item: "minecraft:gold_ingot", min: 1, max: 1, tier: "rare" },
    { item: "minecraft:trident", min: 1, max: 1, tier: "epic" }
  ],
  "minecraft:witch": [
    { item: "minecraft:glowstone_dust", min: 1, max: 4, tier: "common" },
    { item: "minecraft:redstone", min: 1, max: 4, tier: "common" },
    { item: "minecraft:sugar", min: 1, max: 3, tier: "common" },
    { item: "minecraft:glass_bottle", min: 1, max: 3, tier: "common" },
    { item: "minecraft:experience_bottle", min: 1, max: 2, tier: "rare" }
  ],
  "minecraft:guardian": [
    { item: "minecraft:prismarine_shard", min: 1, max: 4, tier: "common" },
    { item: "minecraft:prismarine_crystals", min: 1, max: 3, tier: "common" },
    { item: "minecraft:cod", min: 1, max: 2, tier: "common" },
    { item: "minecraft:sea_lantern", min: 1, max: 1, tier: "rare" }
  ],
  "minecraft:elder_guardian": [
    { item: "minecraft:prismarine_shard", min: 2, max: 6, tier: "common" },
    { item: "minecraft:prismarine_crystals", min: 2, max: 5, tier: "common" },
    { item: "minecraft:sponge", min: 1, max: 2, tier: "rare" },
    { item: "minecraft:tide_armor_trim_smithing_template", min: 1, max: 1, tier: "epic" }
  ],
  "minecraft:husk": [
    { item: "minecraft:rotten_flesh", min: 1, max: 3, tier: "common" },
    { item: "minecraft:iron_ingot", min: 1, max: 1, tier: "rare" },
    { item: "minecraft:sand", min: 1, max: 4, tier: "common" }
  ],
  "minecraft:stray": [
    { item: "minecraft:bone", min: 1, max: 3, tier: "common" },
    { item: "minecraft:arrow", min: 2, max: 4, tier: "common" },
    { item: "minecraft:packed_ice", min: 1, max: 2, tier: "rare" }
  ],
  "minecraft:pillager": [
    { item: "minecraft:arrow", min: 2, max: 5, tier: "common" },
    { item: "minecraft:emerald", min: 1, max: 2, tier: "rare" },
    { item: "minecraft:crossbow", min: 1, max: 1, tier: "rare" }
  ],
  "minecraft:vindicator": [
    { item: "minecraft:emerald", min: 1, max: 3, tier: "common" },
    { item: "minecraft:iron_axe", min: 1, max: 1, tier: "rare" },
    { item: "minecraft:totem_of_undying", min: 1, max: 1, tier: "epic" }
  ],
  "minecraft:evoker": [
    { item: "minecraft:emerald", min: 1, max: 4, tier: "common" },
    { item: "minecraft:totem_of_undying", min: 1, max: 1, tier: "rare" },
    { item: "minecraft:book", min: 1, max: 2, tier: "common" }
  ],
  "minecraft:hoglin": [
    { item: "minecraft:porkchop", min: 2, max: 4, tier: "common" },
    { item: "minecraft:leather", min: 1, max: 3, tier: "common" },
    { item: "minecraft:cooked_porkchop", min: 1, max: 2, tier: "rare" }
  ],
  "minecraft:piglin_brute": [
    { item: "minecraft:gold_ingot", min: 2, max: 5, tier: "common" },
    { item: "minecraft:golden_axe", min: 1, max: 1, tier: "rare" },
    { item: "minecraft:gold_block", min: 1, max: 1, tier: "epic" }
  ],
  "minecraft:magma_cube": [
    { item: "minecraft:magma_cream", min: 1, max: 3, tier: "common" },
    { item: "minecraft:magma", min: 1, max: 2, tier: "rare" }
  ],
  "minecraft:slime": [
    { item: "minecraft:slime_ball", min: 1, max: 4, tier: "common" },
    { item: "minecraft:slime_block", min: 1, max: 1, tier: "rare" }
  ],
  "minecraft:ghast": [
    { item: "minecraft:ghast_tear", min: 1, max: 2, tier: "common" },
    { item: "minecraft:gunpowder", min: 1, max: 3, tier: "common" },
    { item: "minecraft:fire_charge", min: 2, max: 4, tier: "rare" }
  ],
  "minecraft:shulker": [
    { item: "minecraft:shulker_shell", min: 1, max: 2, tier: "common" },
    { item: "minecraft:purpur_block", min: 1, max: 4, tier: "rare" }
  ],

  // --- Животные ---
  "minecraft:cow": [
    { item: "minecraft:leather", min: 1, max: 3, tier: "common" },
    { item: "minecraft:beef", min: 1, max: 3, tier: "common" }
  ],
  "minecraft:pig": [
    { item: "minecraft:porkchop", min: 1, max: 3, tier: "common" },
    { item: "minecraft:cooked_porkchop", min: 1, max: 1, tier: "rare" }
  ],
  "minecraft:sheep": [
    { item: "minecraft:mutton", min: 1, max: 3, tier: "common" },
    { item: "minecraft:white_wool", min: 1, max: 2, tier: "common" }
  ],
  "minecraft:chicken": [
    { item: "minecraft:chicken", min: 1, max: 2, tier: "common" },
    { item: "minecraft:feather", min: 1, max: 3, tier: "common" },
    { item: "minecraft:egg", min: 1, max: 2, tier: "rare" }
  ],
  "minecraft:rabbit": [
    { item: "minecraft:rabbit", min: 1, max: 2, tier: "common" },
    { item: "minecraft:rabbit_hide", min: 1, max: 2, tier: "common" },
    { item: "minecraft:rabbit_foot", min: 1, max: 1, tier: "rare" }
  ],
  "minecraft:cod": [
    { item: "minecraft:cod", min: 1, max: 2, tier: "common" },
    { item: "minecraft:bone_meal", min: 1, max: 2, tier: "common" }
  ],
  "minecraft:salmon": [
    { item: "minecraft:salmon", min: 1, max: 2, tier: "common" },
    { item: "minecraft:bone_meal", min: 1, max: 2, tier: "common" }
  ],
  "minecraft:turtle": [
    { item: "minecraft:seagrass", min: 1, max: 3, tier: "common" },
    { item: "minecraft:turtle_scute", min: 1, max: 1, tier: "rare" }
  ]
};

// ============ СИСТЕМА КОМБО ============
const playerComboData = new Map(); // playerId -> { kills, lastKillTick }

/**
 * Получает данные комбо игрока
 */
function getComboData(playerId) {
  if (!playerComboData.has(playerId)) {
    playerComboData.set(playerId, { kills: 0, lastKillTick: 0 });
  }
  return playerComboData.get(playerId);
}

/**
 * Обновляет комбо игрока
 */
function updateCombo(playerId, currentTick) {
  const combo = getComboData(playerId);
  const timeSinceLastKill = currentTick - combo.lastKillTick;

  if (timeSinceLastKill <= CONFIG.COMBO_TIMEOUT_TICKS) {
    // Продолжаем комбо
    combo.kills++;
  } else {
    // Комбо сброшено
    combo.kills = 1;
  }

  combo.lastKillTick = currentTick;
  return combo.kills;
}

/**
 * Вычисляет бонус от комбо
 */
function getComboBonus(comboKills) {
  const bonus = (comboKills - 1) * CONFIG.COMBO_BONUS_PER_KILL;
  return Math.min(bonus, CONFIG.MAX_COMBO_BONUS);
}

// ============ СТАТИСТИКА ============
const playerStats = new Map(); // playerId -> { totalExtraLoot, rareDrops, epicDrops, highestCombo }

/**
 * Получает статистику игрока
 */
function getPlayerStats(playerId) {
  if (!playerStats.has(playerId)) {
    playerStats.set(playerId, {
      totalExtraLoot: 0,
      rareDrops: 0,
      epicDrops: 0,
      highestCombo: 0,
      totalKills: 0
    });
  }
  return playerStats.get(playerId);
}

/**
 * Обновляет статистику игрока
 */
function updateStats(playerId, tier, amount, comboKills) {
  const stats = getPlayerStats(playerId);
  stats.totalExtraLoot += amount;
  stats.totalKills++;

  if (tier === "rare") stats.rareDrops++;
  if (tier === "epic") stats.epicDrops++;
  if (comboKills > stats.highestCombo) stats.highestCombo = comboKills;
}

// ============ УТИЛИТЫ ============

/**
 * Получает шанс на основе уровня и тира
 */
function getChanceForTier(tier, fortuneLevel, comboBonus) {
  let baseChance = 0;
  switch (tier) {
    case "common":
      baseChance = fortuneLevel * CONFIG.BASE_CHANCE_PER_LEVEL;
      break;
    case "rare":
      baseChance = fortuneLevel * CONFIG.RARE_CHANCE_PER_LEVEL;
      break;
    case "epic":
      baseChance = fortuneLevel * CONFIG.EPIC_CHANCE_PER_LEVEL;
      break;
    default:
      baseChance = fortuneLevel * CONFIG.BASE_CHANCE_PER_LEVEL;
  }
  return baseChance + comboBonus;
}

/**
 * Получает цвет для тира лута
 */
function getTierColor(tier) {
  switch (tier) {
    case "common": return "§a";   // Зелёный
    case "rare": return "§9";     // Синий
    case "epic": return "§5";     // Фиолетовый
    default: return "§f";         // Белый
  }
}

/**
 * Получает название тира на русском
 */
function getTierName(tier) {
  switch (tier) {
    case "common": return "Обычный";
    case "rare": return "Редкий";
    case "epic": return "Эпический";
    default: return "Неизвестный";
  }
}

/**
 * Создаёт визуальные эффекты при дропе
 */
function spawnDropEffects(dimension, location, tier) {
  try {
    if (tier === "rare" && CONFIG.PARTICLE_ON_RARE) {
      dimension.runCommand(
        `particle minecraft:villager_happy ${location.x} ${location.y + 0.5} ${location.z}`
      );
    }
    if (tier === "epic") {
      if (CONFIG.PARTICLE_ON_RARE) {
        dimension.runCommand(
          `particle minecraft:totem_particle ${location.x} ${location.y + 0.5} ${location.z}`
        );
      }
      if (CONFIG.SOUND_ON_EPIC) {
        dimension.runCommand(
          `playsound random.totem ${location.x} ${location.y} ${location.z} 1 1`
        );
      }
    }
  } catch (e) {
    // Эффекты не критичны
  }
}

/**
 * Отправляет уведомление ближайшим игрокам о редком дропе
 */
function notifyNearbyPlayers(dimension, location, killerName, mobName, itemName, tier) {
  if (tier !== "epic") return;

  try {
    const nearbyPlayers = dimension.getEntities({
      type: "minecraft:player",
      location: location,
      maxDistance: CONFIG.NOTIFY_RADIUS
    });

    for (const player of nearbyPlayers) {
      player.sendMessage(
        `§d[ЭПИЧЕСКИЙ ДРОП] §f${killerName} получил §5${itemName}§f с ${mobName}!`
      );
    }
  } catch (e) {
    // Уведомления не критичны
  }
}

// ============ ОСНОВНАЯ ЛОГИКА ============

// Счётчик тиков для комбо
let globalTick = 0;
system.runInterval(() => {
  globalTick++;
}, 1);

world.afterEvents.entityDie.subscribe((event) => {
  const deadEntity = event.deadEntity;
  const killer = event.damageSource?.damagingEntity;

  // Проверяем что убийца - игрок
  if (!killer || killer.typeId !== "minecraft:player") return;

  // Получаем предмет в руке
  try {
    const equipment = killer.getComponent(EntityComponentTypes.Equippable);
    if (!equipment) return;

    const weapon = equipment.getEquipment(EquipmentSlot.Mainhand);
    if (!weapon) return;

    // Проверяем зачарование "Удача" (fortune)
    const enchantable = weapon.getComponent("minecraft:enchantable");
    if (!enchantable) return;

    const enchantments = enchantable.getEnchantments();
    let fortuneLevel = 0;

    for (const ench of enchantments) {
      if (ench.type.id === "fortune") {
        fortuneLevel = ench.level;
        break;
      }
    }

    if (fortuneLevel <= 0) return;

    // Обновляем комбо
    const comboKills = updateCombo(killer.id, globalTick);
    const comboBonus = getComboBonus(comboKills);

    // Получаем лут для этого моба
    const lootTable = MOB_LOOT_TABLE[deadEntity.typeId];
    if (!lootTable) return;

    // Спавним доп. лут на основе уровня удачи
    const location = deadEntity.location;
    const dimension = deadEntity.dimension;
    let droppedSomething = false;
    let highestTierDropped = "common";

    for (const lootEntry of lootTable) {
      // Вычисляем шанс на основе тира
      const chance = getChanceForTier(lootEntry.tier, fortuneLevel, comboBonus);

      if (Math.random() > chance) continue;

      // Количество доп. предметов
      const extraCount = Math.floor(Math.random() * (lootEntry.max - lootEntry.min + 1)) + lootEntry.min;
      if (extraCount <= 0) continue;

      droppedSomething = true;

      // Обновляем лучший тир
      if (lootEntry.tier === "epic") highestTierDropped = "epic";
      else if (lootEntry.tier === "rare" && highestTierDropped !== "epic") highestTierDropped = "rare";

      // Обновляем статистику
      if (CONFIG.STATS_ENABLED) {
        updateStats(killer.id, lootEntry.tier, extraCount, comboKills);
      }

      // Спавним предмет
      system.run(() => {
        try {
          const itemStack = new ItemStack(lootEntry.item, extraCount);
          dimension.spawnItem(itemStack, location);

          // Эффекты
          spawnDropEffects(dimension, location, lootEntry.tier);

          // Уведомление о эпическом дропе
          if (lootEntry.tier === "epic") {
            const mobName = deadEntity.typeId.replace("minecraft:", "");
            const itemName = lootEntry.item.replace("minecraft:", "");
            notifyNearbyPlayers(dimension, location, killer.name, mobName, itemName, lootEntry.tier);
          }
        } catch (e) {
          // Предмет может не существовать в данной версии
        }
      });
    }

    // Сообщение игроку
    if (droppedSomething && fortuneLevel >= CONFIG.SHOW_MESSAGES_MIN_LEVEL) {
      system.run(() => {
        try {
          const mobName = deadEntity.typeId.replace("minecraft:", "");
          const tierColor = getTierColor(highestTierDropped);
          let message = `${tierColor}[Удача ${fortuneLevel}] §fДоп. лут с §e${mobName}`;

          // Добавляем инфо о комбо
          if (comboKills > 1) {
            message += ` §6[x${comboKills} комбо +${Math.round(comboBonus * 100)}%]`;
          }

          killer.sendMessage(message);
        } catch (e) {
          // Сообщение не критично
        }
      });
    }

  } catch (e) {
    // Ошибки не критичны
  }
});

// ============ КОМАНДА СТАТИСТИКИ ============
world.beforeEvents.chatSend.subscribe((event) => {
  const message = event.message;
  const player = event.sender;

  if (message === "!luck" || message === "!удача") {
    event.cancel = true;

    system.run(() => {
      const stats = getPlayerStats(player.id);
      const combo = getComboData(player.id);

      player.sendMessage("§6=== Статистика Удачи ===");
      player.sendMessage(`§f Убийств с удачей: §e${stats.totalKills}`);
      player.sendMessage(`§f Доп. предметов получено: §a${stats.totalExtraLoot}`);
      player.sendMessage(`§f Редких дропов: §9${stats.rareDrops}`);
      player.sendMessage(`§f Эпических дропов: §5${stats.epicDrops}`);
      player.sendMessage(`§f Лучшее комбо: §6x${stats.highestCombo}`);
      player.sendMessage(`§f Текущее комбо: §6x${combo.kills}`);
      player.sendMessage("§6========================");
    });
  }
});
