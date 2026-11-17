/**
 * physics.ts — физика автомобиля: raycast-модель с 4 колёсами, шины по упрощённой
 * формуле Пачеки (Pacejka), продольные/поперечные перекосы нагрузки, привод на заднюю
 * ось (RWD), ручник с блокировкой задних колёс.
 *
 * Координаты: плоскость XZ, ось Y вверх. Поворот руля: yaw = 0 → машина смотрит в −Z.
 * Вперёд: f = (−sin yaw, −cos yaw). Вправо: r = (−f.z, f.x) = (cos yaw·−1... ) → r = (−fz, fx).
 * Положительный omega (рысканье) = поворот влево (против часовой сверху), поэтому
 * «вправо» (D) даёт отрицательный руль и отрицательный omega.
 *
 * Устойчивость: фиксированный шаг из игрового цикла дробится на 2 сабстепа (120 Гц),
 * все силы шин ограничены трением (μ·Fz) — модель не «взрывается» ни при каких вводах.
 */

export interface CarControls {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** −1..1, +1 = вправо */
  steer: number;
  handbrake: boolean;
}

/** Данные о поверхности под колесом (заполняет трасса, объект переиспользуется). */
export interface GroundInfo {
  /** множитель сцепления (асфальт 1.0, трава ниже) */
  grip: number;
  /** коэффициент сопротивления качению */
  roll: number;
  /** множитель аэродинамического сопротивления */
  dragMul: number;
  /** боковое смещение от осевой линии, + = справа по ходу */
  lat: number;
  /** единичный вектор от осевой линии к машине */
  nx: number;
  nz: number;
  /** ближайшая точка осевой линии */
  cx: number;
  cz: number;
}

export const CAR = {
  mass: 1350,
  inertia: 1750,
  axleFront: -1.35, // локальная z передней оси (вперёд = −z)
  axleRear: 1.35,
  trackHalf: 0.81, // половина колеи (локальная x)
  cgHeight: 0.55,
  wheelRadius: 0.34,
  wheelInertia: 1.6,
  /** вязкое демпфирование вращения колеса, Н·м·с (подшипники — физичное значение;
   * слишком большое демпфирование само создаёт постоянное проскальзывание!) */
  wheelDamp: 1.2,
  peakTorque: 420, // Н·м (~257 л.с.)
  peakRpm: 4300,
  idleRpm: 950,
  maxRpm: 7200,
  gears: [0, 3.5, 2.25, 1.55, 1.18, 0.95], // индекс = передача 1..5
  reverseRatio: 3.0,
  finalDrive: 3.8,
  driveEff: 0.88,
  brakeTorque: 1500, // на колесо
  handbrakeTorque: 3800,
  dragCoef: 0.45, // 0.5·ρ·Cd·A
  steerMaxLow: 0.66, // рад на малых скоростях
  steerMaxHigh: 0.13, // рад на скорости steerSpeedRef
  steerSpeedRef: 55,
  pacejkaB: 10, // боковое проскальзывание (угол в рад)
  pacejkaC: 1.3,
  slipB: 7, // продольное проскальзывание (доля) — мягче начальный наклон кривой
  mu: 1.05, // базовое сцепление на асфальте
  /** запас по передку: машина слегка недостерующая — иначе задний привод
   * при равном μ осей на грани устойчивости (пауэр-оверстир от любого шума) */
  muFront: 1.14,
  muRear: 1.08,
  /** демпфер рысканья, Н·м на рад/с (аналог стабилизатора/развала колёс) */
  yawDamp: 500,
  /** мягкая «противобуксовка»: начинает резать момент при проскальзывании задней
   * оси больше tcStart, полностью — к tcFull (доля, 0.3 ≈ 30% пробуксовки) */
  tcStart: 0.4,
  tcFull: 0.9,
} as const;

const G = 9.81;
const WHEEL_LX = [-CAR.trackHalf, CAR.trackHalf, -CAR.trackHalf, CAR.trackHalf];
const WHEEL_LZ = [CAR.axleFront, CAR.axleFront, CAR.axleRear, CAR.axleRear];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}
/** Упрощённая форма Пачеки: D·sin(C·atan(B·x)). */
function pacejka(x: number, B: number, C: number): number {
  return Math.sin(C * Math.atan(B * x));
}
/** Крутящий момент двигателя от оборотов. */
function torqueCurve(rpm: number): number {
  const x = (rpm - CAR.peakRpm) / 2900;
  return clamp(1 - x * x, 0.42, 1);
}

export class CarPhysics {
  // состояние в мировой системе
  x = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  omega = 0; // рысканье, рад/с (+ = влево)
  steer = 0; // угол поворота передних колёс, рад (− = вправо)

  // колёса: 0 FL, 1 FR, 2 RL, 3 RR
  readonly wheelSpin = [0, 0, 0, 0]; // угол вращения (для визуала)
  readonly wheelOmega = [0, 0, 0, 0];

  gear = 1; // 1..5 или -1 (задняя)
  rpm: number = CAR.idleRpm;
  private shiftTimer = 0;
  /** сглаженное продольное проскальзывание задней оси (для «противобуксовки») */
  private rearSlip = 0;

  // сглаженные ускорения для перекоса нагрузки (читаются визуалом кузова)
  axSm = 0;
  aySm = 0;

  // выходы для HUD/звука/эффектов
  speed = 0; // м/с
  slipAngle = 0; // угол скольжения корпуса, рад
  drifting = false;
  lastImpact = 0; // скорость удара о барьер, м/с
  grass = false;

  reset(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.omega = 0;
    this.steer = 0;
    this.wheelSpin.fill(0);
    this.wheelOmega.fill(0);
    this.gear = 1;
    this.rpm = CAR.idleRpm;
    this.shiftTimer = 0;
    this.rearSlip = 0;
    this.axSm = 0;
    this.aySm = 0;
    this.speed = 0;
    this.slipAngle = 0;
    this.drifting = false;
    this.lastImpact = 0;
  }

  shiftUp(): void {
    if (this.gear === -1) {
      this.gear = 1;
    } else if (this.gear < 5) {
      this.gear += 1;
    } else {
      return;
    }
    this.shiftTimer = 0.15;
  }

  shiftDown(): void {
    if (this.gear > 1) {
      this.gear -= 1;
      this.shiftTimer = 0.15;
    } else if (this.gear === 1 && this.speed < 2) {
      this.gear = -1; // задняя — только почти с места
      this.shiftTimer = 0.15;
    }
  }

  update(dt: number, ctl: CarControls, ground: (x: number, z: number, out: GroundInfo) => void, gOut: GroundInfo): void {
    const SUB = 3; // 180 Гц: жёсткая продольная кривая Пачеки требует мелкого шага
    const h = dt / SUB;
    this.lastImpact = 0; // удар записывается в сабстепе — отдаём наружу один раз за шаг
    for (let s = 0; s < SUB; s++) this.substep(h, ctl, ground, gOut);
  }

  private substep(h: number, ctl: CarControls, ground: (x: number, z: number, out: GroundInfo) => void, g: GroundInfo): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const fx = -sin;
    const fz = -cos;
    const rx = -fz;
    const rz = fx;

    // --- руль: полный угол на малых скоростях, узкий на больших ---
    this.speed = Math.hypot(this.vx, this.vz);
    const sf = clamp(this.speed / CAR.steerSpeedRef, 0, 1);
    const maxSteer = CAR.steerMaxLow + (CAR.steerMaxHigh - CAR.steerMaxLow) * sf;
    const steerTarget = -ctl.steer * maxSteer; // D (+1) → руль вправо = отрицательный угол
    const steerRate = Math.abs(steerTarget) > Math.abs(this.steer) ? 4.6 : 7.0;
    this.steer = approach(this.steer, steerTarget, steerRate * h);
    if (this.shiftTimer > 0) this.shiftTimer -= h;

    // --- двигатель: обороты от ведущей оси + «выжим сцепления» на старте ---
    const ratio = this.gear === -1 ? -CAR.reverseRatio : CAR.gears[this.gear];
    const wRear = 0.5 * (this.wheelOmega[2] + this.wheelOmega[3]);
    let rpm = Math.abs(wRear * ratio * CAR.finalDrive) * 60 / (2 * Math.PI);
    if (ctl.throttle > 0.15) {
      // сцепление буксует: обороты следуют за педалью на старте, с ростом
      // скорости — за колёсами (иначе бесконечный выжиг на ограничителе)
      const slipBlend = Math.max(0, 1 - this.speed / 8);
      rpm = Math.max(rpm, CAR.idleRpm + ctl.throttle * (CAR.maxRpm - CAR.idleRpm) * 0.62 * slipBlend);
    } else {
      rpm = Math.max(rpm, CAR.idleRpm);
    }
    rpm = Math.min(rpm, CAR.maxRpm + 400);
    let engineTq = CAR.peakTorque * torqueCurve(rpm) * ctl.throttle;
    if (this.shiftTimer > 0) engineTq = 0; // пауза переключения
    // «противобуксовка»: не даём задней оси уйти в глубокий выжиг — иначе шины
    // съедают круг трения продольно, боковой запас падает и машину разворачивает
    const tc = clamp((this.rearSlip - CAR.tcStart) / (CAR.tcFull - CAR.tcStart), 0, 1);
    engineTq *= 1 - 0.5 * tc;
    if (rpm > CAR.maxRpm) engineTq *= 0.15; // мягкий ограничитель
    this.rpm = rpm;

    // --- распределение вертикальной нагрузки ---
    const L = CAR.axleRear - CAR.axleFront;
    const m = CAR.mass;
    const dLongF = (-m * this.axSm * CAR.cgHeight / L) / 2; // торможение: прирост на перед
    const dLongR = (m * this.axSm * CAR.cgHeight / L) / 2;
    const latW = (m * this.aySm * CAR.cgHeight) / (CAR.trackHalf * 2 * 2); // на внешнее колесо
    const baseLoad = (m * G * 0.25);

    let FxTot = 0;
    let FzTot = 0;
    let tauYaw = 0;
    let rearSigSum = 0;

    for (let i = 0; i < 4; i++) {
      const lx = WHEEL_LX[i];
      const lz = WHEEL_LZ[i];
      const isFront = i < 2;
      const isDriven = i >= 2;

      // мировая позиция колеса и его скорость (v + ω×p)
      const px = lx * cos + lz * sin;
      const pz = -lx * sin + lz * cos;
      const wx = this.x + px;
      const wz = this.z + pz;
      ground(wx, wz, g);

      let Fz = baseLoad + (isFront ? dLongF : dLongR) + (lx > 0 ? latW : -latW);
      Fz = clamp(Fz, 400, 20000);
      const mu = (isFront ? CAR.muFront : CAR.muRear) * g.grip;
      const loadSens = clamp(1 - 0.000015 * (Fz - 3300), 0.75, 1.1);
      const D = mu * Fz * loadSens;

      // скорость колеса в осях колеса
      const steerAngle = isFront ? this.steer : 0;
      const phi = this.yaw + steerAngle;
      const fwx = -Math.sin(phi);
      const fwz = -Math.cos(phi);
      const rwx = -fwz;
      const rwz = fwx;
      const vwx = this.vx + this.omega * pz;
      const vwz = this.vz - this.omega * px;
      const vLong = vwx * fwx + vwz * fwz;
      const vLat = vwx * rwx + vwz * rwz;

      // проскальзывания. У знаменателя угла сноса — опорная скорость 1 м/с:
      // иначе при vL→0 atan2 шумит и машина «крутит бублик» на месте
      const alpha = Math.atan2(vLat, vLong + 1.0); // угол сноса шины
      const w = this.wheelOmega[i];
      const sigma = (w * CAR.wheelRadius - vLong) / Math.max(Math.abs(vLong), 1.0);
      if (isDriven) rearSigSum += sigma;

      let Fxi = D * pacejka(sigma, CAR.slipB, CAR.pacejkaC);
      let Fyi = D * pacejka(alpha, CAR.pacejkaB, CAR.pacejkaC);

      // совместное проскальзывание: круг трения (|Fx|+|Fy| ≤ μN)
      const sum = Math.abs(Fxi) + Math.abs(Fyi);
      if (sum > D) {
        const k = D / sum;
        Fxi *= k;
        Fyi *= k;
      }

      // ручник: задние колёса блокируются продольно, удержание в боковом падает
      if (ctl.handbrake && isDriven) {
        Fxi = clamp(-vLong * 55, -D * 0.95, D * 0.95);
        Fyi *= 0.55;
      }

      // силы в мировую систему. Боковая сила противодействует сносу шины
      // (α<0 — снос влево относительно колеса → сила вправо): F = Fx·f_w − Fy·r_w
      const Fwx = Fxi * fwx - Fyi * rwx;
      const Fwz = Fxi * fwz - Fyi * rwz;
      FxTot += Fwx;
      FzTot += Fwz;
      // момент силы относительно CG: (p × F)_y = pz·Fx − px·Fz
      // (знак важен: задняя ось даёт стабилизирующий момент; перепутанный знак
      // превращает машину в «карусель» — разворачивает на газу)
      tauYaw += pz * Fwx - px * Fwz;

      // вращение колеса: привод, тормоз, реакция шины
      let Tw = 0;
      if (isDriven && this.shiftTimer <= 0) {
        Tw = (engineTq * ratio * CAR.finalDrive * CAR.driveEff) / 2;
      }
      if (ctl.brake > 0.01) {
        Tw -= ctl.brake * CAR.brakeTorque * Math.tanh(w * 10);
      }
      if (ctl.handbrake && isDriven) {
        Tw -= CAR.handbrakeTorque * Math.tanh(w * 10);
      }
      const dw = (Tw - Fxi * CAR.wheelRadius - CAR.wheelDamp * w) / CAR.wheelInertia;
      this.wheelOmega[i] += dw * h;
      if (Math.abs(this.wheelOmega[i]) < 0.02 && Math.abs(Tw) < 1) this.wheelOmega[i] = 0;
      this.wheelSpin[i] += this.wheelOmega[i] * h;
    }

    // сглаженное проскальзывание задней оси — «противобуксовка» читает его на следующем шаге
    this.rearSlip += (rearSigSum / 2 - this.rearSlip) * 0.3;

    // --- сопротивление воздуха и качению ---
    const spd = this.speed;
    if (spd > 0.01) {
      const inv = 1 / spd;
      const fAero = CAR.dragCoef * spd * spd * g.dragMul;
      const fRoll = g.roll * m * G;
      const fr = (fAero + fRoll) * inv;
      FxTot -= this.vx * fr;
      FzTot -= this.vz * fr;
      this.grass = g.grip < 0.8;
    } else {
      this.grass = false;
    }
    // «стояночный» тормоз: глушим ползание на месте без газа
    if (spd < 0.4 && ctl.throttle < 0.05) {
      const damp = Math.exp(-6 * h);
      this.vx *= damp;
      this.vz *= damp;
    }

    // --- интегрирование ---
    const ax = FxTot / m;
    const az = FzTot / m;
    this.vx += ax * h;
    this.vz += az * h;
    this.omega += ((tauYaw - CAR.yawDamp * this.omega) / CAR.inertia) * h;
    this.omega = clamp(this.omega, -6, 6);
    this.yaw += this.omega * h;
    this.x += this.vx * h;
    this.z += this.vz * h;

    // ускорения для перекоса нагрузки (переиспользуем прошлый шаг — без циклической зависимости)
    const axF = ax * fx + az * fz;
    const vLongNow = this.vx * fx + this.vz * fz;
    const ayR = -this.omega * vLongNow; // + = к центру правого поворота
    this.axSm += (axF - this.axSm) * 0.25;
    this.aySm += (ayR - this.aySm) * 0.25;

    // --- барьеры: не даём уехать с трассы ---
    ground(this.x, this.z, g);
    const wallLat = 9.2;
    const absLat = Math.abs(g.lat);
    if (absLat > wallLat) {
      const over = absLat - wallLat;
      this.x -= g.nx * over;
      this.z -= g.nz * over;
      const vn = this.vx * g.nx + this.vz * g.nz;
      if (vn > 0) {
        this.lastImpact = vn;
        this.vx -= g.nx * vn * 1.35;
        this.vz -= g.nz * vn * 1.35;
        this.omega *= 0.92;
      }
    }

    // --- выходы ---
    this.speed = Math.hypot(this.vx, this.vz);
    this.slipAngle = Math.atan2(this.vx * rx + this.vz * rz, Math.abs(this.vx * fx + this.vz * fz) + 0.001);
    this.drifting = this.speed > 5 && Math.abs(this.slipAngle) > 0.2 && Math.abs(this.slipAngle) < 1.3;
  }
}
