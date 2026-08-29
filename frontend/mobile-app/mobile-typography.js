// 폰트 파일을 추가하지 않고 iOS/Android 기본 한글 글꼴과 접근성 확대를 유지한다.
const typography = Object.freeze({
  title: { fontSize: 18, lineHeight: 26, fontWeight: "700" },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
  meta: { fontSize: 12, lineHeight: 18, fontWeight: "400" },
  metric: { fontSize: 24, lineHeight: 32, fontWeight: "700" },
});
const titleStyles = new Set(["shellTitle", "heroTitle", "surfaceTitle", "moduleTitle", "aiTitle", "messengerRoomTitle", "composeTitle", "employeeSearchModalTitle", "homeGreeting"]);
const nameStyles = new Set(["listTitle", "homeRowTitle", "employeeSearchName", "directoryName", "userName", "mailSubject", "selectedScheduleTitle"]);
const glyphStyles = new Set(["shellHeaderActionText", "mailStar", "calendarArrow", "aiAddButton", "aiSendText", "messengerSendText", "messengerHeaderIcon", "backGlyph"]);

function withMobileTypography(styles) {
  return Object.fromEntries(Object.entries(styles).map(([name, style]) => {
    // 색상 전용 보조 스타일은 기본 텍스트 스타일의 크기/굵기를 그대로 상속한다.
    if (glyphStyles.has(name)) return [name, style];
    const roleName = name.replace(/(?:Active|Selected|Unread)$/, "");
    const roleStyle = roleName === name ? style : { ...(styles[roleName] || {}), ...style };
    const hasTypography = roleStyle.fontSize || roleStyle.fontWeight || roleStyle.lineHeight;
    const semanticText = titleStyles.has(roleName) || nameStyles.has(roleName) || /Title|Label|ButtonText|Close|Link|Action|Chip|Role|Kicker|Filter|Input$|^input$|^listBody$|settingsValue/.test(roleName);
    if (!hasTypography && style.color && !semanticText) return [name, style];
    const isText = hasTypography || semanticText;
    if (!isText) return [name, style];
    let role = "body";
    if (titleStyles.has(roleName)) role = "title";
    else if (/^(homeStatValue|homeSummaryValue|metricValue)$/.test(roleName)) role = "metric";
    else if (nameStyles.has(roleName) || /Title|Label|ButtonText|Close|Link|Action|Chip|Role|Kicker|Filter/.test(roleName)) role = "label";
    else if (/Meta|Date|Time|Count|Status|Note|Desc|Preview|Empty|Unit/.test(roleName) || (roleStyle.fontSize && roleStyle.fontSize <= 12)) role = "meta";
    if (/Input$|^input$|messageText|^listBody$|settingsValue/i.test(roleName)) role = "body";
    return [name, { ...style, ...typography[role] }];
  }));
}
module.exports = { typography, withMobileTypography };
