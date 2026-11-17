/**
 * Home.tsx — DOM-оболочка: канвас + HUD и экраны (титул/пауза).
 * Игра в src/game/ сама обновляет содержимое элементов по id — React не рендерится 60 раз в секунду.
 */

import { useEffect, useRef } from 'react'
import { startGame, stopGame } from '@/game/boot'

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    startGame(canvas)
    return () => stopGame()
  }, [])

  return (
    <div id="game-root">
      <canvas id="game-canvas" ref={canvasRef} />

      <div id="ui-overlay">
        {/* HUD во время езды */}
        <div id="hud" className="hidden">
          <div id="hud-left">
            <div id="speed-block">
              <span id="speed-val">0</span>
              <span className="unit">км/ч</span>
            </div>
            <div id="gear-block">
              <span className="label">Передача</span>
              <span id="gear-val">1</span>
            </div>
            <div id="rpm-bar">
              <div id="rpm-fill" />
            </div>
            <div id="slip-block">
              <span className="label">Снос</span>
              <span><span id="slip-val">0</span>°</span>
            </div>
            <div id="grass-tag">ТРАВА</div>
            <div id="drift-tag">ДРИФТ</div>
          </div>

          <div id="hud-right">
            <div id="score-block">
              <span className="label">Очки дрифта</span>
              <span id="score-val">0</span>
              <span id="mult-val" />
            </div>
            <div id="best-block">
              <span className="label">Рекорд</span>
              <span id="best-val">0</span>
            </div>
          </div>

          <div id="hud-help">
            W/S — газ/тормоз · A/D — руль · Space — ручник · Shift/Ctrl или E/Q — передачи ·
            R — сброс на трассу · C — камера · M — звук · Esc — пауза
          </div>
        </div>

        {/* Титульный экран */}
        <div id="title-screen">
          <div className="panel">
            <h1>ДРИФТ-ЛАБ</h1>
            <p className="subtitle">
              Мини-движок автосимулятора: шины по Пачеке, задний привод, перекос нагрузки,
              ручник и пробуксовка. Кольцевая трасса — набери очков за дрифт.
            </p>
            <div className="controls-grid">
              <span>W / S</span><span>газ / тормоз, задняя</span>
              <span>A / D</span><span>рулевое управление</span>
              <span>Space</span><span>ручник (занос)</span>
              <span>Shift / Ctrl</span><span>передача вверх / вниз</span>
              <span>E / Q</span><span>то же, альтернатива</span>
              <span>R</span><span>вернуться на трассу</span>
              <span>C</span><span>камера: погоня / капот</span>
              <span>мышь</span><span>смотреть по сторонам (зажать)</span>
            </div>
            <p className="tip">Занос: войди в поворот, крутани руль, дай газу и дёрни ручник — лови контру.</p>
            <p className="best">Рекорд: <span id="best-val-title">0</span></p>
            <div className="btn-row">
              <button id="start-btn" className="btn primary">Старт (Пробел)</button>
              <button id="mute-btn" className="btn">Звук: вкл</button>
            </div>
          </div>
        </div>

        {/* Пауза */}
        <div id="pause-screen" className="hidden">
          <div className="panel">
            <h2>Пауза</h2>
            <div className="btn-row">
              <button id="resume-btn" className="btn primary">Продолжить (Esc)</button>
              <button id="menu-btn" className="btn">В меню</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
