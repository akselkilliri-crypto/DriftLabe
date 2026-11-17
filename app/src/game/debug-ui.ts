/**
 * debug-ui.ts — панель настройки коэффициентов физики в реальном времени.
 * Использует dat.gui через CDN для быстрого подбора параметров без перекомпиляции.
 */
import * as dat from "dat.gui";
import { CAR } from "./physics";

const STORAGE_KEY = "driftLabTune";

const ORIGINAL: Record<string, number> = {};
for (const k of Object.keys(CAR)) {
  if (typeof CAR[k as keyof typeof CAR] === "number") {
    ORIGINAL[k] = CAR[k as keyof typeof CAR] as number;
  }
}

function saveToStorage(): void {
  const params: Record<string, number> = {};
  for (const k of Object.keys(CAR)) {
    if (typeof CAR[k as keyof typeof CAR] === "number") {
      params[k] = CAR[k as keyof typeof CAR] as number;
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
}

function loadFromStorage(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const params = JSON.parse(raw);
    for (const k of Object.keys(params)) {
      if (k in CAR && typeof (CAR as Record<string, unknown>)[k] === "number") {
        (CAR as Record<string, number>)[k] = params[k];
      }
    }
    return true;
  } catch { return false; }
}

function exportJSON(): void {
  const params: Record<string, number> = {};
  for (const k of Object.keys(CAR)) {
    if (typeof CAR[k as keyof typeof CAR] === "number") {
      params[k] = CAR[k as keyof typeof CAR] as number;
    }
  }
  const blob = new Blob([JSON.stringify(params, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "driftlab-tune.json"; a.click();
  URL.revokeObjectURL(url);
}

function importJSON(): void {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const params = JSON.parse(text);
      for (const k of Object.keys(params)) {
        if (k in CAR && typeof (CAR as Record<string, unknown>)[k] === "number") {
          (CAR as Record<string, number>)[k] = params[k];
        }
      }
      location.reload();
    } catch (e) { alert("Ошибка импорта: " + (e as Error).message); }
  };
  input.click();
}

function resetAll(): void {
  for (const k of Object.keys(ORIGINAL)) {
    (CAR as Record<string, number>)[k] = ORIGINAL[k];
  }
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

export function initDebugUI(): void {
  loadFromStorage();
  const gui = new dat.GUI({ width: 320 });
  gui.domElement.style.position = "fixed";
  gui.domElement.style.top = "10px";
  gui.domElement.style.right = "10px";
  gui.domElement.style.zIndex = "9999";

  const fMass = gui.addFolder("Масса и инерция");
  fMass.add(CAR as Record<string, number>, "mass", 800, 2500).step(10).name("Масса (кг)");
  fMass.add(CAR as Record<string, number>, "inertia", 800, 3000).step(10).name("Инерция (кг·м²)");
  fMass.add(CAR as Record<string, number>, "cgHeight", 0.3, 0.9).step(0.01).name("Высота ЦТ (м)");
  fMass.open();

  const fWheels = gui.addFolder("Колёса");
  fWheels.add(CAR as Record<string, number>, "wheelRadius", 0.28, 0.4).step(0.01).name("Радиус (м)");
  fWheels.add(CAR as Record<string, number>, "wheelInertia", 0.5, 3).step(0.1).name("Инерция (кг·м²)");
  fWheels.add(CAR as Record<string, number>, "wheelDamp", 0, 5).step(0.1).name("Демпфирование");
  fWheels.add(CAR as Record<string, number>, "trackHalf", 0.6, 1.0).step(0.01).name("Полуколея (м)");
  fWheels.add(CAR as Record<string, number>, "axleFront", -2, -0.8).step(0.05).name("Передняя ось");
  fWheels.add(CAR as Record<string, number>, "axleRear", 0.8, 2).step(0.05).name("Задняя ось");

  const fEngine = gui.addFolder("Двигатель");
  fEngine.add(CAR as Record<string, number>, "peakTorque", 200, 800).step(10).name("Пик момента (Н·м)");
  fEngine.add(CAR as Record<string, number>, "peakRpm", 3000, 6000).step(100).name("Пик RPM");
  fEngine.add(CAR as Record<string, number>, "idleRpm", 600, 1200).step(50).name("Холостой");
  fEngine.add(CAR as Record<string, number>, "maxRpm", 6000, 9000).step(100).name("Макс RPM");
  fEngine.add(CAR as Record<string, number>, "finalDrive", 2.5, 5).step(0.1).name("Главная пара");
  fEngine.add(CAR as Record<string, number>, "driveEff", 0.7, 1).step(0.01).name("КПД привода");

  const fBrakes = gui.addFolder("Тормоза");
  fBrakes.add(CAR as Record<string, number>, "brakeTorque", 500, 3000).step(50).name("Момент (Н·м)");
  fBrakes.add(CAR as Record<string, number>, "handbrakeTorque", 1000, 6000).step(100).name("Ручник (Н·м)");

  const fTires = gui.addFolder("Шины");
  fTires.add(CAR as Record<string, number>, "mu", 0.5, 1.5).step(0.01).name("Базовое μ");
  fTires.add(CAR as Record<string, number>, "muFront", 0.8, 1.5).step(0.01).name("μ перед");
  fTires.add(CAR as Record<string, number>, "muRear", 0.8, 1.5).step(0.01).name("μ зад");
  fTires.add(CAR as Record<string, number>, "pacejkaB", 5, 15).step(0.5).name("Пачека B");
  fTires.add(CAR as Record<string, number>, "pacejkaC", 1, 2).step(0.05).name("Пачека C");
  fTires.add(CAR as Record<string, number>, "slipB", 3, 12).step(0.5).name("Slip B");
  fTires.open();

  const fSteer = gui.addFolder("Руль");
  fSteer.add(CAR as Record<string, number>, "steerMaxLow", 0.3, 1).step(0.01).name("Макс угол (медл)");
  fSteer.add(CAR as Record<string, number>, "steerMaxHigh", 0.05, 0.3).step(0.01).name("Макс угол (быстр)");
  fSteer.add(CAR as Record<string, number>, "steerSpeedRef", 30, 80).step(5).name("Скорость реф");

  const fStab = gui.addFolder("Стабилизация");
  fStab.add(CAR as Record<string, number>, "yawDamp", 0, 1500).step(25).name("Демпфер рысканья");
  fStab.add(CAR as Record<string, number>, "tcStart", 0.2, 0.8).step(0.05).name("TC start");
  fStab.add(CAR as Record<string, number>, "tcFull", 0.6, 1.2).step(0.05).name("TC full");

  const fDrag = gui.addFolder("Сопротивление");
  fDrag.add(CAR as Record<string, number>, "dragCoef", 0.2, 0.8).step(0.01).name("Аэродинамика");

  const btns = {
    save: () => { saveToStorage(); alert("Настройки сосранены в localStorage"); },
    export: exportJSON,
    import: importJSON,
    reset: () => { if (confirm("Сбросить все настройки к исходным?")) resetAll(); },
  };
  gui.add(btns, "save").name("💾 Сохранить");
  gui.add(btns, "export").name("📤 Экспорт JSON");
  gui.add(btns, "import").name("📥 Импорт JSON");
  gui.add(btns, "reset").name("🔄 Сбросить");

  gui.__controllers?.forEach((c: Record<string, unknown>) => {
    const orig = c.onFinishChange as ((...a: unknown[]) => void) | undefined;
    c.onFinishChange = (...args: unknown[]) => {
      orig?.apply(c, args);
      saveToStorage();
    };
  });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.code === "F2") {
      gui.domElement.style.display = gui.domElement.style.display === "none" ? "block" : "none";
    }
  });

  console.log("Debug UI initialized. Press F2 to toggle.");
}
