// Source metadata stays available for export matching; removed scenery must
// also stay out of runtime collision and any future map-derived interactions.
export function isRemovedMapPart(path) {
  return /^\/Workspace\/(FriendNpc|InviteFriend|Furnace)(?:\/|$)/.test(path);
}
