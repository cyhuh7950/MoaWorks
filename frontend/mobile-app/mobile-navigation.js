function createSettingsHistory() {
  let previous = null;
  return {
    enter(current) {
      if (!(current.activeTab === "more" && current.moreScreen === "settings" && !current.moreMenuOpen)) previous = { ...current };
      return { activeTab: "more", moreScreen: "settings", moreMenuOpen: false };
    },
    back() {
      const destination = previous || { activeTab: "home", moreScreen: "directory", moreMenuOpen: true };
      previous = null;
      return { ...destination };
    },
    reset() { previous = null; },
  };
}
module.exports = { createSettingsHistory };
