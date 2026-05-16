import { world, system } from "@minecraft/server";

/**
 * ============================================================
 * VANILLA TWEAKS - Улучшенные ванильные механики
 * ============================================================
 * Главный файл аддона. Загружает все модули и управляет общими
 * системами: помощь, статус, отладка.
 *
 * Модули:
 * 1. lootLuck.js       - Удача работает на мобах (больше лута)
 * 2. villagerBuilder.js - Жители медленно строят дома
 * 3. villagerInherit.js - Дети жителей наследуют профессию
 *
 * Команды:
 * !help / !помощь   - Показать справку
 * !luck / !удача    - Статистика удачи
 * !family / !семья  - Статистика наследования
 * !tree / !дерево   - Семейное дерево ближайшего жителя
 * !status / !статус - Общий статус аддона
 * ============================================================
 */

// ============ ЗАГРУЗКА МОДУЛЕЙ ============
import "./lootLuck.js";
import "./villagerBuilder.js";
import "./villagerInherit.js";

// ============ ИНФОРМАЦИЯ ОБ АДДОНЕ ============
const ADDON_INFO = {
  name: "Vanilla Tweaks",
  version: "1.0.0",
  author: "Custom",
  modules: [
    { name: "Удача на мобах", status: "active", command: "!luck" },
    { name: "Строительство жителей", status: "active", command: "нет" },
    { name: "Наследование профессий", status: "active", command: "!family" }
  ]
};

// ============ ВРЕМЯ ЗАПУСКА ============
let startTick = 0;
let isLoaded = false;

system.run(() => {
  startTick = system.currentTick;
  isLoaded = true;
  world.sendMessage("§a[Vanilla Tweaks v1.0.0] §fАддон загружен! Все механики активны.");
  world.sendMessage("§7 Напишите §e!help §7или §e!помощь §7для списка команд.");
});

// ============ СИСТЕМА КОМАНД ============
world.beforeEvents.chatSend.subscribe((event) => {
  const message = event.message.toLowerCase().trim();
  const player = event.sender;

  // Команда помощи
  if (message === "!help" || message === "!помощь") {
    event.cancel = true;
    system.run(() => {
      showHelp(player);
    });
    return;
  }

  // Команда статуса
  if (message === "!status" || message === "!статус") {
    event.cancel = true;
    system.run(() => {
      showStatus(player);
    });
    return;
  }
});

/**
 * Показывает справку по аддону
 */
function showHelp(player) {
  player.sendMessage("§6╔══════════════════════════════════════╗");
  player.sendMessage("§6║   §fVANILLA TWEAKS - Справка          §6║");
  player.sendMessage("§6╠══════════════════════════════════════╣");
  player.sendMessage("§6║                                      §6║");
  player.sendMessage("§6║ §a● Удача на мобах                    §6║");
  player.sendMessage("§6║   §7Убивай мобов оружием с Удачей      §6║");
  player.sendMessage("§6║   §7для дополнительного лута.          §6║");
  player.sendMessage("§6║   §7Комбо убийств = больше шанс!       §6║");
  player.sendMessage("§6║                                      §6║");
  player.sendMessage("§6║ §a● Строительство жителей              §6║");
  player.sendMessage("§6║   §7Жители ставят блоки днём если      §6║");
  player.sendMessage("§6║   §7рядом есть другие жители.          §6║");
  player.sendMessage("§6║   §7Стиль адаптируется к биому.        §6║");
  player.sendMessage("§6║                                      §6║");
  player.sendMessage("§6║ §a● Наследование профессий             §6║");
  player.sendMessage("§6║   §7Дети жителей получают профессию     §6║");
  player.sendMessage("§6║   §7ближайшего взрослого при росте.    §6║");
  player.sendMessage("§6║                                      §6║");
  player.sendMessage("§6╠══════════════════════════════════════╣");
  player.sendMessage("§6║ §eКоманды:                             §6║");
  player.sendMessage("§6║  §f!luck §7/ §f!удача  §8- стат. лута       §6║");
  player.sendMessage("§6║  §f!family §7/ §f!семья §8- наследование   §6║");
  player.sendMessage("§6║  §f!tree §7/ §f!дерево §8- семья жителя    §6║");
  player.sendMessage("§6║  §f!status §7/ §f!статус §8- статус       §6║");
  player.sendMessage("§6║  §f!help §7/ §f!помощь §8- эта справка     §6║");
  player.sendMessage("§6╚══════════════════════════════════════╝");
}

/**
 * Показывает статус аддона
 */
function showStatus(player) {
  const uptimeTicks = system.currentTick - startTick;
  const uptimeSeconds = Math.floor(uptimeTicks / 20);
  const uptimeMinutes = Math.floor(uptimeSeconds / 60);
  const uptimeHours = Math.floor(uptimeMinutes / 60);

  let uptimeStr;
  if (uptimeHours > 0) {
    uptimeStr = `${uptimeHours}ч ${uptimeMinutes % 60}м`;
  } else if (uptimeMinutes > 0) {
    uptimeStr = `${uptimeMinutes}м ${uptimeSeconds % 60}с`;
  } else {
    uptimeStr = `${uptimeSeconds}с`;
  }

  player.sendMessage("§6=== Статус Vanilla Tweaks ===");
  player.sendMessage(`§f Версия: §a${ADDON_INFO.version}`);
  player.sendMessage(`§f Время работы: §e${uptimeStr}`);
  player.sendMessage(`§f Загружен: §a${isLoaded ? "Да" : "Нет"}`);
  player.sendMessage("§6--- Модули ---");

  for (const module of ADDON_INFO.modules) {
    const statusIcon = module.status === "active" ? "§a●" : "§c●";
    player.sendMessage(`  ${statusIcon} §f${module.name} §7(${module.command})`);
  }

  // Информация о мире
  try {
    const players = world.getAllPlayers();
    player.sendMessage(`§f Игроков онлайн: §b${players.length}`);
    player.sendMessage(`§f Время суток: §e${world.getTimeOfDay()}`);
  } catch (e) {
    // Не критично
  }

  player.sendMessage("§6============================");
}

// ============ ПРИВЕТСТВИЕ НОВЫХ ИГРОКОВ ============
world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.initialSpawn) {
    const player = event.player;
    system.runTimeout(() => {
      player.sendMessage("§a[Vanilla Tweaks] §fДобро пожаловать! Этот мир использует улучшенные механики.");
      player.sendMessage("§7 Напишите §e!help §7для подробностей.");
    }, 60); // 3 секунды после спавна
  }
});
