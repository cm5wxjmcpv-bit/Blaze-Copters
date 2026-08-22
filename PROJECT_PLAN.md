# Blaze Copters Project Plan

## Locked game direction

- 1-6 players, cross-platform browser play.
- No gameplay action buttons.
- Phone/tablet uses touch joystick.
- Computer uses directional keyboard controls.
- Helicopter automatically drops water when above fire.
- Helicopter automatically refills when hovering at water.
- Six unique helicopter colors, no duplicates in a room.
- Host creates room and is the only player who starts a match.
- Difficulty selected before play.
- Fire pressure scales with player count without becoming a giant HP sponge.
- Three simple shared team upgrades between rounds: water capacity, flight speed, and fire suppression.
- The room host selects the team upgrade before starting the next round.
- No hard individual winner in standard co-op.
- Burned terrain gradually becomes green again.
- Map language: trees, grass, dirt roads, flowers, small cabins, water source.
- Story mode is cooperative.
- Versus mode is a later secondary mode where one side creates/spreads fire and the other suppresses it.
- The selected game mode and level must remain shared and validated for every player.
- New players join in the lobby; existing players can reconnect during an active round.
- Cloudflare owns room permissions, round deadlines, room cleanup, and validated match snapshots.
- Final graphics will be simple, colorful sprite-sheet animation.

## Milestones

1. Local gameplay shell and controls.
2. Cloudflare room/lobby server.
3. Real 1-6 player synchronization.
4. Recoverable shared match state, authenticated reconnects, and cloud-owned round deadlines.
5. Shared team upgrades and round progression.
6. Additional cooperative game modes, mission maps, and level progression.
7. Versus mode, with stronger server-side simulation authority before competitive play.
8. Sprite art, animation, sound, polish.
9. Mobile browser testing, screen scaling, and reconnect handling.
10. Deployment and private friend testing.
