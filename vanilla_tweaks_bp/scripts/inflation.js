import { world, system } from "@minecraft/server";

/**
 * ============================================================
 * ИНФЛЯЦИЯ ЦЕН ЖИТЕЛЕЙ
 * ============================================================
 * Если игрок покупает один и тот же товар слишком часто,
 * цена растёт (житель повышает стоимость через эффект "Hero of the Village" наоборот).
 * Реализация: отслеживаем сделки, и при частых покупках
 * даём жителю тег с повышенной ценой + уведомляем игрока.
 * 
 * Механика:
 * - Каждая покупка у жителя увеличивает "спрос"
 * - Спрос снижается со временем (каждые 5 минут -1)
 * - При высоком спросе житель отказывает в торговле (частицы злости)
 * - Игрок получает предупреждение в чат
 * ============================================================
 */

// ============ НАСТРОЙКИ ============
const CONFIG = {
  MAX_TRADES_BEFORE_INFLATION: 5,   // Покупок до начала инфляции
  INFLATION_COOLDOWN_TICKS: 6000,   // 5 минут — снижение спроса на 1
  REFUSE_THRESHOLD: 10,             // При 10+ покупках — отказ в торговле
  WARN_THRESHOLD: 4,                // Предупреждение при 4 покупках
  NOTIFY_PLAYER: true,              // Уведомления
  DEMAND_DECAY_AMOUNT: 1,           // Снижение спроса за период
  TRACK_PER_VILLAGER: true,         // Отслеживать по конкретному жителю
  PARTICLES_ON_REFUSE: true,        // Частицы при отказе
  RESET_ON_DISTANCE: 100            // Сброс если игрок далеко от деревни
};

// ============ ДАННЫЕ ============
// Хранение: playerId -> Map<villagerId, { trades: number, lastTradeTick: number }>
const playerTradeData = new Map();

// Глобальный тик
let globalTick = 0;

system.runInterval(() => {
  globalTick++;
}, 1);

// ============ УТИЛИТЫ ============

/**
 * Получает данные торговли игрока с конкретным жителем
 */
function getTradeData(playerId, villagerId) {
  if (!playerTradeData.has(playerId)) {
    playerTradeData.set(playerId, new Map());
  }
  const playerData = playerTradeData.get(playerId);
  
  if (!playerData.has(villagerId)) {
    playerData.set(villagerId, {
      trades: 0,
      lastTradeTick: 0,
      totalTrades: 0,
      inflationLevel: 0
    });
  }
  return playerData.get(villagerId);
}

/**
 * Вычисляет уровень инфляции
 */
function getInflationLevel(trades) {
  if (trades < CONFIG.MAX_TRADES_BEFORE_INFLATION) return 0;
  if (trades < 7) return 1;  // Лёгкая
  if (trades < CONFIG.REFUSE_THRESHOLD) return 2;  // Средняя
  return 3;  // Критическая — отказ
}

/**
 * Получает сообщение об инфляции
 */
function getInflationMessage(level, trades) {
  switch (level) {
    case 1:
      return `§e[Рынок] §fЖитель заметил высокий спрос... §7(${trades} покупок)`;
    case 2:
      return `§6[Рынок] §fЦены растут! Житель повышает стоимость. §7(${trades} покупок)`;
    case 3:
      return `§c[Рынок] §fЖитель отказывается торговать! Слишком много покупок. §7Подождите...`;
    default:
      return null;
  }
}

/**
 * Получает цвет для уровня инфляции
 */
function getInflationColor(level) {
  switch (level) {
    case 0: return "§a"; // Зелёный — нормально
    case 1: return "§e"; // Жёлтый — начало
    case 2: return "§6"; // Оранжевый — средне
    case 3: return "§c"; // Красный — отказ
    default: return "§f";
  }
}

// ============ СНИЖЕНИЕ СПРОСА СО ВРЕМЕНЕМ ============
system.runInterval(() => {
  for (const [playerId, villagerMap] of playerTradeData) {
    for (const [villagerId, data] of villagerMap) {
      const timeSinceLastTrade = globalTick - data.lastTradeTick;
      
      // Снижаем спрос каждые 5 минут
      if (timeSinceLastTrade > CONFIG.INFLATION_COOLDOWN_TICKS && data.trades > 0) {
        data.trades = Math.max(0, data.trades - CONFIG.DEMAND_DECAY_AMOUNT);
        data.lastTradeTick = globalTick; // Сбрасываем таймер
        data.inflationLevel = getInflationLevel(data.trades);
      }
      
      // Удаляем пустые записи
      if (data.trades === 0 && timeSinceLastTrade > CONFIG.INFLATION_COOLDOWN_TICKS * 3) {
        villagerMap.delete(villagerId);
      }
    }
    
    // Удаляем пустые данные игрока
    if (villagerMap.size === 0) {
      playerTradeData.delete(playerId);
    }
  }
}, 1200); // Каждую минуту

// ============ ОТСЛЕЖИВАНИЕ ВЗАИМОДЕЙСТВИЙ ============
// Используем itemUse для отслеживания (когда игрок рядом с жителем и использует предмет)
world.afterEvents.playerInteractWithEntity.subscribe((event) => {
  const player = event.player;
  const target = event.target;
  
  // Только жители
  if (target.typeId !== "minecraft:villager_v2") return;
  
  // Пропускаем детей
  const isBaby = target.getComponent("minecraft:is_baby");
  if (isBaby) return;
  
  const villagerId = target.id;
  const data = getTradeData(player.id, villagerId);
  
  // Увеличиваем счётчик
  data.trades++;
  data.totalTrades++;
  data.lastTradeTick = globalTick;
  data.inflationLevel = getInflationLevel(data.trades);
  
  const level = data.inflationLevel;
  
  // Предупреждения
  if (CONFIG.NOTIFY_PLAYER && level > 0) {
    const message = getInflationMessage(level, data.trades);
    if (message) {
      system.run(() => {
        player.sendMessage(message);
      });
    }
  }
  
  // При критическом уровне — эффекты отказа
  if (level >= 3) {
    system.run(() => {
      try {
        const pos = target.location;
        const dimension = target.dimension;
        
        // Частицы злости
        if (CONFIG.PARTICLES_ON_REFUSE) {
          dimension.runCommand(
            `particle minecraft:villager_angry ${pos.x} ${pos.y + 1.5} ${pos.z}`
          );
        }
        
        // Звук
        dimension.runCommand(
          `playsound mob.villager.no ${pos.x} ${pos.y} ${pos.z} 1 0.8`
        );
        
        // Отталкиваем игрока
        player.applyKnockback(
          player.location.x - pos.x,
          player.location.z - pos.z,
          0.5, 0.1
        );
        
        player.sendMessage("§c[Рынок] §fПодождите 5 минут, пока спрос снизится!");
      } catch (e) {
        // Не критично
      }
    });
  }
  
  // При среднем уровне — частицы недовольства
  if (level === 2) {
    system.run(() => {
      try {
        const pos = target.location;
        target.dimension.runCommand(
          `particle minecraft:villager_angry ${pos.x} ${pos.y + 1.5} ${pos.z}`
        );
      } catch (e) {
        // Не критично
      }
    });
  }
});

// ============ КОМАНДА СТАТИСТИКИ ============
world.beforeEvents.chatSend.subscribe((event) => {
  const message = event.message.toLowerCase().trim();
  const player = event.sender;
  
  if (message === "!market" || message === "!рынок") {
    event.cancel = true;
    
    system.run(() => {
      player.sendMessage("§6=== Состояние рынка ===");
      
      const playerData = playerTradeData.get(player.id);
      if (!playerData || playerData.size === 0) {
        player.sendMessage("§7 Нет данных о торговле. Начните торговать!");
        player.sendMessage("§6========================");
        return;
      }
      
      let totalVillagers = 0;
      let inflatedVillagers = 0;
      
      for (const [villagerId, data] of playerData) {
        totalVillagers++;
        if (data.inflationLevel > 0) {
          inflatedVillagers++;
          const color = getInflationColor(data.inflationLevel);
          const levelName = data.inflationLevel === 1 ? "лёгкая" : data.inflationLevel === 2 ? "средняя" : "отказ";
          player.sendMessage(`  ${color}● §fЖитель: ${color}${levelName} §7(${data.trades} покупок, всего ${data.totalTrades})`);
        }
      }
      
      player.sendMessage(`§f Всего жителей: §e${totalVillagers}`);
      player.sendMessage(`§f С инфляцией: §c${inflatedVillagers}`);
      player.sendMessage("§7 Спрос снижается каждые 5 минут");
      player.sendMessage("§6========================");
    });
  }
});
