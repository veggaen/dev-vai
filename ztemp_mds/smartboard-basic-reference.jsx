import { useState, useEffect, useRef, useCallback } from "react";

// ─── SmartBoard™ — Basic Tier Reference Implementation ───
// This is what BASIC should look like. Not a boring todo list.
// Polished, animated, over-engineered UX.

const BOARDS_INIT = [
  { id: "1", name: "Work", emoji: "📋", color: "#22c55e", items: [
    { id: "i1", text: "Set up project structure", done: true },
    { id: "i2", text: "Design the database schema", done: true },
    { id: "i3", text: "Build REST API endpoints", done: false },
    { id: "i4", text: "Connect React frontend", done: false },
    { id: "i5", text: "Add drag-to-reorder feature", done: false },
  ]},
  { id: "2", name: "Personal", emoji: "🏠", color: "#a78bfa", items: [
    { id: "i6", text: "Buy groceries for the week", done: false },
    { id: "i7", text: "Schedule dentist appointment", done: false },
    { id: "i8", text: "Read 30 pages of current book", done: false },
  ]},
  { id: "3", name: "Shopping", emoji: "🛒", color: "#f59e0b", items: [
    { id: "i9", text: "Milk (2 liters)", done: false },
    { id: "i10", text: "Bread — sourdough", done: false },
    { id: "i11", text: "Chicken breast (500g)", done: true },
    { id: "i12", text: "Fresh vegetables", done: false },
    { id: "i13", text: "Coffee beans", done: false },
    { id: "i14", text: "Dish soap", done: false },
  ]},
  { id: "4", name: "Today", emoji: "☀️", color: "#06b6d4", items: [
    { id: "i15", text: "Morning standup — 09:00", done: true },
    { id: "i16", text: "Code review for PR #247", done: false },
    { id: "i17", text: "Deploy staging environment", done: false },
  ]},
];

// ─── Floating Particles Component ───
function Particles() {
  const canvasRef = useRef(null);
  const particles = useRef([]);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    particles.current = Array.from({ length: 35 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2.5 + 0.5,
      speedX: (Math.random() - 0.5) * 0.25,
      speedY: (Math.random() - 0.5) * 0.25,
      alpha: Math.random() * 0.12,
      alphaDir: Math.random() > 0.5 ? 1 : -1,
    }));

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles.current) {
        p.x += p.speedX; p.y += p.speedY;
        p.alpha += p.alphaDir * 0.0008;
        if (p.alpha >= 0.14) p.alphaDir = -1;
        if (p.alpha <= 0.02) p.alphaDir = 1;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34, 197, 94, ${p.alpha})`;
        ctx.fill();
      }
      animRef.current = requestAnimationFrame(animate);
    }
    animate();

    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}

// ─── Cursor Border Box ───
function CursorBox() {
  const boxRef = useRef(null);
  const currentRect = useRef({ x: 0, y: 0, w: 0, h: 0, r: 8 });
  const targetRect = useRef({ x: 0, y: 0, w: 0, h: 0, r: 8 });
  const visible = useRef(false);
  const animating = useRef(false);

  useEffect(() => {
    const selector = "button, a, input, textarea, [data-hover], .card-item, .board-item, .sidebar-board";

    function lerp(a, b, t) { return a + (b - a) * t; }

    function animateBox() {
      const c = currentRect.current;
      const t = targetRect.current;
      const speed = 0.18;
      c.x = lerp(c.x, t.x, speed);
      c.y = lerp(c.y, t.y, speed);
      c.w = lerp(c.w, t.w, speed);
      c.h = lerp(c.h, t.h, speed);
      c.r = lerp(c.r, t.r, speed);

      const box = boxRef.current;
      if (box) {
        box.style.transform = `translate(${c.x}px, ${c.y}px)`;
        box.style.width = `${c.w}px`;
        box.style.height = `${c.h}px`;
        box.style.borderRadius = `${c.r}px`;
        box.style.opacity = visible.current ? "1" : "0";
      }

      const dx = Math.abs(c.x - t.x) + Math.abs(c.y - t.y);
      if (dx > 0.5) {
        requestAnimationFrame(animateBox);
      } else {
        animating.current = false;
      }
    }

    function onMouseOver(e) {
      const target = e.target.closest(selector);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const cs = getComputedStyle(target);
      targetRect.current = {
        x: rect.left - 3, y: rect.top - 3,
        w: rect.width + 6, h: rect.height + 6,
        r: parseFloat(cs.borderRadius) || 8,
      };
      visible.current = true;
      if (!animating.current) { animating.current = true; requestAnimationFrame(animateBox); }
    }

    document.addEventListener("mouseover", onMouseOver);
    return () => document.removeEventListener("mouseover", onMouseOver);
  }, []);

  return (
    <div ref={boxRef} style={{
      position: "fixed", top: 0, left: 0, pointerEvents: "none", zIndex: 9999,
      border: "2px solid rgba(34,197,94,0.5)",
      boxShadow: "0 0 14px rgba(34,197,94,0.12), inset 0 0 14px rgba(34,197,94,0.04)",
      opacity: 0, transition: "opacity 200ms",
    }} />
  );
}

// ─── Progress Bar ───
function ProgressBar({ done, total, color }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#71717a" }}>
      <div style={{ flex: 1, height: 3, background: "#27272a", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", borderRadius: 2,
          background: color, transition: "width 500ms cubic-bezier(0.16,1,0.3,1)",
          boxShadow: `0 0 8px ${color}33`,
        }} />
      </div>
      <span>{done}/{total}</span>
    </div>
  );
}

// ─── Main App ───
export default function SmartBoard() {
  const [boards, setBoards] = useState(BOARDS_INIT);
  const [activeBoard, setActiveBoard] = useState("1");
  const [newItemText, setNewItemText] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [boardError, setBoardError] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingItem, setEditingItem] = useState(null);
  const [editText, setEditText] = useState("");
  const [deletingItems, setDeletingItems] = useState(new Set());
  const [addingItems, setAddingItems] = useState(new Set());
  const inputRef = useRef(null);
  const boardInputRef = useRef(null);

  const board = boards.find(b => b.id === activeBoard);
  const doneCount = board ? board.items.filter(i => i.done).length : 0;

  // Add item
  const addItem = () => {
    if (!newItemText.trim()) return;
    const newId = `i${Date.now()}`;
    setBoards(prev => prev.map(b => b.id === activeBoard ? {
      ...b, items: [{ id: newId, text: newItemText.trim(), done: false }, ...b.items]
    } : b));
    setAddingItems(prev => new Set(prev).add(newId));
    setTimeout(() => setAddingItems(prev => { const n = new Set(prev); n.delete(newId); return n; }), 400);
    setNewItemText("");
    inputRef.current?.focus();
  };

  // Toggle item
  const toggleItem = (itemId) => {
    setBoards(prev => prev.map(b => b.id === activeBoard ? {
      ...b, items: b.items.map(i => i.id === itemId ? { ...i, done: !i.done } : i)
    } : b));
  };

  // Delete item
  const deleteItem = (itemId) => {
    setDeletingItems(prev => new Set(prev).add(itemId));
    setTimeout(() => {
      setBoards(prev => prev.map(b => b.id === activeBoard ? {
        ...b, items: b.items.filter(i => i.id !== itemId)
      } : b));
      setDeletingItems(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    }, 300);
  };

  // Edit item
  const startEdit = (item) => { setEditingItem(item.id); setEditText(item.text); };
  const saveEdit = () => {
    if (!editText.trim()) return;
    setBoards(prev => prev.map(b => b.id === activeBoard ? {
      ...b, items: b.items.map(i => i.id === editingItem ? { ...i, text: editText.trim() } : i)
    } : b));
    setEditingItem(null);
  };

  // Add board
  const addBoard = () => {
    if (!newBoardName.trim()) {
      setBoardError(true);
      boardInputRef.current?.focus();
      return;
    }
    const emojis = ["📌", "🎯", "💡", "🔥", "⚡", "🎨", "📊", "🧪"];
    const colors = ["#f472b6", "#c084fc", "#60a5fa", "#34d399", "#fbbf24", "#fb923c"];
    const newBoard = {
      id: `b${Date.now()}`,
      name: newBoardName.trim().slice(0, 30),
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      color: colors[Math.floor(Math.random() * colors.length)],
      items: [],
    };
    setBoards(prev => [...prev, newBoard]);
    setActiveBoard(newBoard.id);
    setNewBoardName("");
    setShowNewBoard(false);
    setBoardError(false);
  };

  // Sort: active items first, then completed
  const sortedItems = board ? [
    ...board.items.filter(i => !i.done),
    ...board.items.filter(i => i.done),
  ] : [];
  const hasCompleted = board ? board.items.some(i => i.done) : false;
  const firstCompletedIdx = sortedItems.findIndex(i => i.done);

  return (
    <div style={{
      display: "flex", height: "100vh", background: "#0a0a0a", color: "#e5e5e5",
      fontFamily: "'DM Sans', 'Inter', -apple-system, sans-serif", overflow: "hidden",
      position: "relative",
    }}>
      <Particles />
      <CursorBox />

      {/* ─── Sidebar ─── */}
      <div style={{
        width: sidebarOpen ? 260 : 0, minWidth: sidebarOpen ? 260 : 0,
        background: "#0f0f0f", borderRight: "1px solid #1a1a1a",
        display: "flex", flexDirection: "column", overflow: "hidden",
        transition: "width 300ms cubic-bezier(0.16,1,0.3,1), min-width 300ms cubic-bezier(0.16,1,0.3,1)",
        position: "relative", zIndex: 10,
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, color: "#fff",
            boxShadow: "0 0 16px rgba(34,197,94,0.25)",
          }}>S</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>SmartBoard</div>
            <div style={{ fontSize: 11, color: "#52525b" }}>Basic — Starter</div>
          </div>
        </div>

        {/* Board list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
          {boards.map(b => {
            const isActive = b.id === activeBoard;
            const done = b.items.filter(i => i.done).length;
            return (
              <div key={b.id} className="sidebar-board" onClick={() => setActiveBoard(b.id)} style={{
                padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                marginBottom: 2, display: "flex", alignItems: "center", gap: 10,
                background: isActive ? "#1a1a1a" : "transparent",
                borderLeft: isActive ? `3px solid ${b.color}` : "3px solid transparent",
                transition: "all 200ms",
                position: "relative",
              }}>
                {/* Active board breathing line */}
                {isActive && <div style={{
                  position: "absolute", left: -3, top: 0, bottom: 0, width: 3,
                  background: b.color, borderRadius: "0 2px 2px 0",
                  animation: "breathe 3s ease-in-out infinite",
                }} />}
                <span style={{ fontSize: 18 }}>{b.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: isActive ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: "#52525b" }}>{done}/{b.items.length} done</div>
                </div>
                {/* Mini progress dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: b.items.length === 0 ? "#27272a" : done === b.items.length ? b.color : "#27272a",
                  border: `2px solid ${b.items.length > 0 && done === b.items.length ? b.color : "#3f3f46"}`,
                  transition: "all 300ms",
                }} />
              </div>
            );
          })}

          {/* New Board */}
          {showNewBoard ? (
            <div style={{ padding: "8px 12px" }}>
              <input
                ref={boardInputRef}
                value={newBoardName}
                onChange={e => { setNewBoardName(e.target.value); setBoardError(false); }}
                onKeyDown={e => { if (e.key === "Enter") addBoard(); if (e.key === "Escape") { setShowNewBoard(false); setBoardError(false); } }}
                placeholder="Board name..."
                maxLength={30}
                autoFocus
                style={{
                  width: "100%", padding: "8px 10px", borderRadius: 6, fontSize: 13,
                  background: "#141414", color: "#e5e5e5", outline: "none",
                  border: boardError ? "2px solid #ef4444" : "2px solid #27272a",
                  animation: boardError ? "shake 400ms ease-in-out" : "none",
                  transition: "border-color 200ms",
                }}
              />
              {boardError && (
                <div style={{
                  fontSize: 11, color: "#ef4444", marginTop: 4, paddingLeft: 2,
                  animation: "fadeIn 200ms ease-out",
                }}>Name your board</div>
              )}
            </div>
          ) : (
            <div className="sidebar-board" onClick={() => setShowNewBoard(true)} style={{
              padding: "10px 12px", borderRadius: 8, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
              color: "#52525b", marginTop: 4, borderLeft: "3px solid transparent",
              transition: "all 200ms",
            }}>
              <span style={{ fontSize: 16, width: 18, textAlign: "center" }}>+</span>
              <span style={{ fontSize: 13 }}>New Board</span>
            </div>
          )}
        </div>

        {/* Bottom */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a1a", fontSize: 11, color: "#3f3f46" }}>
          VeggaAI — Basic Tier
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", zIndex: 5 }}>
        {/* Top bar */}
        <div style={{
          height: 52, display: "flex", alignItems: "center", padding: "0 20px",
          borderBottom: "1px solid #1a1a1a", gap: 12, flexShrink: 0,
        }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
            background: "none", border: "none", color: "#71717a", cursor: "pointer",
            padding: 6, borderRadius: 6, fontSize: 18, display: "flex", lineHeight: 1,
            transition: "color 150ms",
          }}>☰</button>
          {board && (
            <>
              <span style={{ fontSize: 22 }}>{board.emoji}</span>
              <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>{board.name}</span>
              <span style={{
                fontSize: 12, color: "#52525b", background: "#1a1a1a",
                padding: "2px 8px", borderRadius: 10, marginLeft: 4,
              }}>{doneCount}/{board.items.length}</span>
            </>
          )}
          <div style={{ flex: 1 }} />
          <kbd style={{
            fontSize: 11, color: "#52525b", background: "#141414",
            padding: "2px 8px", borderRadius: 4, border: "1px solid #27272a",
          }}>⌘ K</kbd>
        </div>

        {/* Board content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {board && (
            <div style={{ maxWidth: 640, margin: "0 auto" }}>
              {/* Progress */}
              <div style={{ marginBottom: 20 }}>
                <ProgressBar done={doneCount} total={board.items.length} color={board.color} />
              </div>

              {/* Add item input */}
              <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                <input
                  ref={inputRef}
                  value={newItemText}
                  onChange={e => setNewItemText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addItem(); }}
                  placeholder="What needs to be done?"
                  style={{
                    flex: 1, padding: "12px 14px", borderRadius: 10, fontSize: 14,
                    background: "#141414", color: "#e5e5e5", outline: "none",
                    border: "2px solid #27272a", transition: "border-color 200ms, box-shadow 200ms",
                  }}
                  onFocus={e => { e.target.style.borderColor = board.color; e.target.style.boxShadow = `0 0 0 3px ${board.color}22`; }}
                  onBlur={e => { e.target.style.borderColor = "#27272a"; e.target.style.boxShadow = "none"; }}
                />
                <button onClick={addItem} style={{
                  padding: "0 16px", borderRadius: 10, border: "none", cursor: "pointer",
                  fontSize: 20, fontWeight: 300, display: "flex", alignItems: "center",
                  background: newItemText.trim() ? board.color : "#1a1a1a",
                  color: newItemText.trim() ? "#fff" : "#3f3f46",
                  transition: "all 200ms",
                  boxShadow: newItemText.trim() ? `0 0 16px ${board.color}33` : "none",
                }}>+</button>
              </div>

              {/* Items */}
              {sortedItems.length === 0 && (
                <div style={{
                  textAlign: "center", padding: "60px 20px", color: "#3f3f46",
                  animation: "fadeIn 400ms ease-out",
                }}>
                  <div style={{ fontSize: 40, marginBottom: 12, filter: "grayscale(0.5)" }}>📝</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: "#52525b" }}>Your board is empty</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Add your first item above</div>
                </div>
              )}

              {sortedItems.map((item, idx) => {
                const isDeleting = deletingItems.has(item.id);
                const isAdding = addingItems.has(item.id);
                const showDivider = idx === firstCompletedIdx && firstCompletedIdx > 0;

                return (
                  <div key={item.id}>
                    {showDivider && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "12px 0", color: "#3f3f46", fontSize: 11, textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}>
                        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
                        Completed
                        <div style={{ flex: 1, height: 1, background: "#1a1a1a" }} />
                      </div>
                    )}
                    <div className="card-item" style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 14px", borderRadius: 10, marginBottom: 4,
                      background: "#111111", border: "1px solid #1a1a1a",
                      opacity: isDeleting ? 0 : item.done ? 0.5 : 1,
                      transform: isDeleting ? "translateX(40px)" : isAdding ? "translateX(0)" : "translateX(0)",
                      transition: "all 300ms cubic-bezier(0.16,1,0.3,1)",
                      animation: isAdding ? "slideInLeft 300ms cubic-bezier(0.16,1,0.3,1)" : "none",
                      cursor: "default",
                    }}>
                      {/* Checkbox */}
                      <div onClick={() => toggleItem(item.id)} style={{
                        width: 20, height: 20, borderRadius: 6, cursor: "pointer",
                        border: item.done ? "none" : "2px solid #3f3f46",
                        background: item.done ? board.color : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 200ms", flexShrink: 0,
                        boxShadow: item.done ? `0 0 8px ${board.color}33` : "none",
                      }}>
                        {item.done && <span style={{ fontSize: 12, color: "#fff", lineHeight: 1 }}>✓</span>}
                      </div>

                      {/* Text */}
                      {editingItem === item.id ? (
                        <input
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingItem(null); }}
                          autoFocus
                          style={{
                            flex: 1, padding: "4px 8px", borderRadius: 6, fontSize: 14,
                            background: "#0a0a0a", color: "#e5e5e5", outline: "none",
                            border: `2px solid ${board.color}`,
                          }}
                        />
                      ) : (
                        <span style={{
                          flex: 1, fontSize: 14,
                          textDecoration: item.done ? "line-through" : "none",
                          color: item.done ? "#52525b" : "#e5e5e5",
                          transition: "all 200ms",
                        }}>{item.text}</span>
                      )}

                      {/* Actions */}
                      <div style={{ display: "flex", gap: 4, opacity: 0.4, transition: "opacity 150ms" }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                        onMouseLeave={e => e.currentTarget.style.opacity = 0.4}
                      >
                        {editingItem === item.id ? (
                          <button onClick={saveEdit} style={{
                            background: "none", border: "none", color: "#22c55e",
                            cursor: "pointer", padding: 4, borderRadius: 4, fontSize: 14,
                          }}>✓</button>
                        ) : (
                          <button onClick={() => startEdit(item)} style={{
                            background: "none", border: "none", color: "#71717a",
                            cursor: "pointer", padding: 4, borderRadius: 4, fontSize: 13,
                          }}>✏️</button>
                        )}
                        <button onClick={() => deleteItem(item.id)} style={{
                          background: "none", border: "none", color: "#71717a",
                          cursor: "pointer", padding: 4, borderRadius: 4, fontSize: 13,
                        }}>🗑️</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div style={{
          padding: "8px 20px", borderTop: "1px solid #1a1a1a",
          fontSize: 11, color: "#27272a", display: "flex", justifyContent: "space-between",
        }}>
          <span>SmartBoard™ Basic</span>
          <span>Press <kbd style={{ background: "#141414", padding: "1px 5px", borderRadius: 3, border: "1px solid #27272a" }}>?</kbd> for shortcuts</span>
        </div>
      </div>

      {/* Global keyframes */}
      <style>{`
        @keyframes breathe {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        input::placeholder { color: #3f3f46; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
        * { scrollbar-width: thin; scrollbar-color: #27272a transparent; }
        button:active { transform: scale(0.97); }
      `}</style>
    </div>
  );
}
