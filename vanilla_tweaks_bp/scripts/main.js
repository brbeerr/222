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
 * 4. inflation.js      - Инфляция цен при частых покупках
 * 5. spiderWeb.js      - Пещерные пауки плетут паутину
 * 6. fullMoon.js       - Полнолуние удваивает спавн мобов
 * 7. rainGrow.js       - Дождь ускоряет рост урожая
 * 8. sitOnStairs.js    - Сидеть на ступеньках
 *
 * Команды:
 * !help / !помощь   - Показать справку
 * !luck / !удача    - Статистика удачи
 * !family / !семья  - Статистика наследования
 * !tree / !дерево   - Семейное дерево ближайшего жителя
 * !market / !рынок  - Состояние рынка (инфляция)
 * !status / !статус - Общий статус аддона
 * ============================================================
 */

// ============ ЗАГРУЗКА МОДУЛЕЙ ============
import "./lootLuck.js";
import "./villagerBuilder.js";
import "./villagerInherit.js";
import "./inflation.js";
import "./spiderWeb.js";
import "./fullMoon.js";
import "./rainGrow.js";
import "./sitOnStairs.js";

// ============ ИНФОРМАЦИЯ ОБ АДДОНЕ ============
const ADDON_INFO = {
  name: "Vanilla Tweaks",
  version: "2.0.0",
  modules: [
    { name: "Удача на мобах", status: "active", command: "!luck" },
    { name: "Строительство жителей", status: "active", command: "—" },
    { name: "Наследование профессий", status: "active", command: "!family" },
    { name: "Инфляция торговли", status: "active", command: "!market" },
    { name: "Пауки плетут паутину", status: "active", command: "—" },
    { name: "Полнолуние х2 мобы", status: "active", command: "—" },
    { name: "Дождь ускоряет урожай", status: "active", command: "—" },
    { name: "Сидеть на ступеньках", status: "active", command: "—" }
  ]
};

// ============ ВРЕМЯ ЗАПУСКА ============
let startTick = 0;
let isLoaded = false;

system.run(() => {
  startTick = system.currentTick;
  isLoaded = true;
  world.sendMessage("§a[Vanilla Tweaks v2.0.0] §fАддон загружен! 8 механик активны.");
  world.sendMessage("§7 Напишите §e!help §7или §e!помощь §7для списка команд.");
});

// ============ СИСТЕМА КОМАНД ============
world.beforeEvents.chatSend.subscribe((event) => {
  const message = event.message.toLowerCase().trim();
  const player = event.sender;

  if (message === "!help" || message === "!помощь") {
    event.cancel = true;
    system.run(() => { showHelp(player); });
    return;
  }

  if (message === "!status" || message === "!статус") {
    event.cancel = true;
    system.run(() => { showStatus(player); });
    return;
  }
});

/**
 * Показывает справку по аддону
 */
function showHelp(player) {
  player.sendMessage("§6╔══════════════════════════════════════╗");
  player.sendMessage("§6║   §fVANILLA TWEAKS v2.0 - Справка     §6║");
  player.sendMessage("§6╠══════════════════════════════════════╣");
  player.sendMessage("§6║ §a● Удача на мобах                    §6║");
  player.sendMessage("§6║   §7Убивай мобов оружием с Удачей      §6║");
  player.sendMessage("§6║   §7Комбо убийств = больше шанс!       §6║");
  player.sendMessage("§6║ §a● Строительство жителей              §6║");
  player.sendMessage("§6║   §7Жители строят дома днём            §6║");
  player.sendMessage("§6║ §a● Наследование профессий             §6║");
  player.sendMessage("§6║   §7Дети получают профессию родителя    §6║");
  player.sendMessage("§6║ §a● Инфляция торговли                  §6║");
  player.sendMessage("§6║   §7Частые покупки = рост цен           §6║");
  player.sendMessage("§6║ §a● Пауки плетут паутину               §6║");
  player.sendMessage("§6║   §7Пещерные пауки оставляют паутину   §6║");
  player.sendMessage("§6║ §a● Полнолуние                         §6║");
  player.sendMessage("§6║   §7Ночью при полной луне мобов х2     §6║");
  player.sendMessage("§6║ §a● Дождь и урожай                     §6║");
  player.sendMessage("§6║   §7Дождь ускоряет рост растений       §6║");
  player.sendMessage("§6║ §a● Сидеть на ступеньках               §6║");
  player.sendMessage("§6║   §7ПКМ пустой рукой = сесть           §6║");
  player.sendMessage("§6║   §7Shift/движение/урон = встать        §6║");
  player.sendMessage("§6╠══════════════════════════════════════╣");
  player.sendMessage("§6║ §eКоманды:                             §6║");
  player.sendMessage("§6║  §f!luck    §8- статистика лута          §6║");
  player.sendMessage("§6║  §f!family  §8- наследование            §6║");
  player.sendMessage("§6║  §f!tree    §8- семья жителя            §6║");
  player.sendMessage("§6║  §f!market  §8- состояние рынка         §6║");
  player.sendMessage("§6║  §f!status  §8- статус аддона           §6║");
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
  player.sendMessage(`§f Модулей: §b${ADDON_INFO.modules.length}`);
  player.sendMessage("§6--- Модули ---");

  for (const module of ADDON_INFO.modules) {
    const statusIcon = module.status === "active" ? "§a●" : "§c●";
    player.sendMessage(`  ${statusIcon} §f${module.name} §7(${module.command})`);
  }

  try {
    const players = world.getAllPlayers();
    player.sendMessage(`§f Игроков: §b${players.length}`);
  } catch (e) {}

  player.sendMessage("§6============================");
}

// ============ ПРИВЕТСТВИЕ НОВЫХ ИГРОКОВ ============
world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.initialSpawn) {
    const player = event.player;
    system.runTimeout(() => {
      player.sendMessage("§a[Vanilla Tweaks] §fДобро пожаловать! Этот мир использует улучшенные механики.");
      player.sendMessage("§7 Напишите §e!help §7для подробностей.");
    }, 60);
  }
});
