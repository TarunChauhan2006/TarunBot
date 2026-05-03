export default function Sidebar({ chats, setChats, setActive }) {
  const newChat = () =>
    setChats([...chats, { id: Date.now(), messages: [] }]);

  return (
    <div className="sidebar">
      <button onClick={newChat}>+ New Chat</button>
      {chats.map((c, i) => (
        <div key={c.id} onClick={() => setActive(i)}>
          Chat {i + 1}
        </div>
      ))}
    </div>
  );
}
