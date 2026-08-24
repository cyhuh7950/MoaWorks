const supportedTranslationLocales = new Set(["ko", "en", "ja", "zh-cn", "es", "fr", "de"]);

function normalizeTranslationLocale(value) {
  const locale = String(value || "").trim().toLowerCase().replace("_", "-");
  if (!supportedTranslationLocales.has(locale)) {
    throw new Error("지원하지 않는 번역 언어입니다.");
  }
  return locale;
}

function buildTranslationPayload(value) {
  return { translationLocale: normalizeTranslationLocale(value) };
}

function messengerViewModel({ rooms = [], selectedRoomId = "", messages = [] } = {}) {
  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) || rooms[0] || null;
  return {
    selectedRoom,
    messages: selectedRoom ? messages.filter((message) => message.roomId === selectedRoom.roomId) : [],
    languageOptions: [
      { value: "ko", label: "한국어" },
      { value: "en", label: "English" },
    ],
  };
}

module.exports = {
  buildTranslationPayload,
  messengerViewModel,
  normalizeTranslationLocale,
};
