import { world, system, EntityComponentTypes, EquipmentSlot, BlockPermutation } from "@minecraft/server";

/**
 * ============================================================
 * ШЁЛКОВОЕ КАСАНИЕ ДОБЫВАЕТ СПАВНЕР
 * ============================================================
 * Киркой с зачарованием "Шёлковое касание" (silk_touch)
 * можно добыть спавнер как предмет и поставить его заново.
 * 
 * Механика:
 * - Ломаешь спавнер киркой с Silk Touch → получаешь спавнер
 * - Спавнер выдаётся через команду /give
 * - При установке спавнер работает (спавнит мобов по умолчанию)
 * - Без Silk Touch — спавнер ломается как обычно (ничего не падает)
 * - Частицы и звук при успешной добыче
 * ============================================================
 */

// ============ НАСТРОЙКИ ============
const CONFIG = {
  NOTIFY_PLAYER: true,              // Уведомление в чат
  PARTICLES_ON_MINE: true,          // Частицы при добыче
  SOUND_ON_MINE: true,              // Звук при добыче
  DAMAGE_PICKAXE: true,             // Кирка теряет прочность
  DURABILITY_COST: 10,              // Сколько прочности тратится
  ONLY_PICKAXES: true               // Только кирками (не лопатами и т.д.)
};

// Все типы кирок
const PICKAXE_TYPES = [
  "minecraft:wooden_pickaxe",
  "minecraft:stone_pickaxe",
  "minecraft:iron_pickaxe",
  "minecraft:golden_pickaxe",
  "minecraft:diamond_pickaxe",
  "minecraft:netherite_pickaxe"
];

/**
 * Проверяет является ли предмет киркой
 */
function isPickaxe(itemTypeId) {
  return PICKAXE_TYPES.includes(itemTypeId);
}

/**
 * Проверяет есть ли Silk Touch на предмете
 */
function hasSilkTouch(item) {
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    if (!enchantable) return false;

    const enchantments = enchantable.getEnchantments();
    for (const ench of enchantments) {
      if (ench.type.id === "silk_touch") {
        return true;
      }
    }
  } catch (e) {
    return false;
  }
  return false;
}

// ============ ОТСЛЕЖИВАНИЕ ЛОМАНИЯ СПАВНЕРА ============
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  const block = event.block;
  const player = event.player;

  // Только спавнеры
  if (block.typeId !== "minecraft:mob_spawner") return;

  // Проверяем инструмент в руке
  try {
    const equipment = player.getComponent(EntityComponentTypes.Equippable);
    if (!equipment) return;

    const mainhand = equipment.getEquipment(EquipmentSlot.Mainhand);
    if (!mainhand) return;

    // Проверяем что это кирка
    if (CONFIG.ONLY_PICKAXES && !isPickaxe(mainhand.typeId)) return;

    // Проверяем Silk Touch
    if (!hasSilkTouch(mainhand)) return;

    // Отменяем стандартное разрушение
    event.cancel = true;

    // Запоминаем позицию для обработки в следующем тике
    const blockPos = {
      x: block.location.x,
      y: block.location.y,
      z: block.location.z
    };

    // Выполняем в следующем тике (после отмены)
    system.run(() => {
      handleSpawnerMine(player, blockPos);
    });

  } catch (e) {
    // Не вмешиваемся при ошибках
  }
});

/**
 * Обрабатывает добычу спавнера
 */
function handleSpawnerMine(player, blockPos) {
  try {
    const dimension = player.dimension;

    // Проверяем что блок всё ещё спавнер
    const block = dimension.getBlock(blockPos);
    if (!block || block.typeId !== "minecraft:mob_spawner") return;

    // Удаляем спавнер
    block.setPermutation(BlockPermutation.resolve("minecraft:air"));

    // Выдаём спавнер игроку через команду
    dimension.runCommand(
      `give "${player.name}" mob_spawner 1`
    );

    // Уменьшаем прочность кирки
    if (CONFIG.DAMAGE_PICKAXE) {
      try {
        const equipment = player.getComponent(EntityComponentTypes.Equippable);
        if (equipment) {
          const mainhand = equipment.getEquipment(EquipmentSlot.Mainhand);
          if (mainhand) {
            const durability = mainhand.getComponent("minecraft:durability");
            if (durability) {
              durability.damage = Math.min(
                durability.damage + CONFIG.DURABILITY_COST,
                durability.maxDurability
              );
              equipment.setEquipment(EquipmentSlot.Mainhand, mainhand);

              // Если кирка сломалась
              if (durability.damage >= durability.maxDurability) {
                equipment.setEquipment(EquipmentSlot.Mainhand, undefined);
                dimension.runCommand(
                  `playsound random.break ${player.location.x} ${player.location.y} ${player.location.z}`
                );
              }
            }
          }
        }
      } catch (e) {
        // Прочность не критична
      }
    }

    // Эффекты
    if (CONFIG.PARTICLES_ON_MINE) {
      dimension.runCommand(
        `particle minecraft:totem_particle ${blockPos.x + 0.5} ${blockPos.y + 0.5} ${blockPos.z + 0.5}`
      );
    }

    if (CONFIG.SOUND_ON_MINE) {
      dimension.runCommand(
        `playsound random.orb ${blockPos.x} ${blockPos.y} ${blockPos.z} 1 0.8`
      );
    }

    // Уведомление
    if (CONFIG.NOTIFY_PLAYER) {
      player.sendMessage("§a[Silk Touch] §fСпавнер добыт! Установите его в нужном месте.");
    }

  } catch (e) {
    // При ошибке — не критично
  }
}
