# liljevduel

https://github.com/user-attachments/assets/6261a8cf-bed7-46cc-bb68-dd52879ac45c

a small top down arena shooter where every enemy is controlled by jev, typesafe's system one model.

one gun, one health bar, walls, medkits. you and the bots are identical units. the bot is a three layer controller:

- a planner proposes positions the bot could move to (a* pathfinding, cover search, flank and retreat sampling) and describes each one in words: travel, distance to the enemy, line of sight, whether both could shoot.
- jev reads the situation and picks one, about three times a second per bot.
- code walks the path, leads the aim, and fires on line of sight.

the aim, the pathing, and the reaction time are code, and that is most of why the bots hit you. jev only decides where the bot stands. a scoring function over the same options would probably play about as well. the reason to build it this way is that the model returns a calibrated choice in one call, fast enough to sit inside a control loop, so the bot's behavior is one sentence of doctrine and the same loop works on any state you can describe in words.

press tab in game to see the options each bot was given, the probabilities jev returned, and the raw request and response. the overlay draws each bot's path, its candidate positions, its aim, line of sight, and weapon range.

## run

you need node 20 or newer and a typesafe api key from https://console.typesafe.ai.

```
node server.mjs
```

open http://localhost:8787, paste your key on the start screen, press play. or put the key in a file named `.env` next to the server so you never have to paste it:

```
TYPESAFE_API_KEY=your_key_here
```

the server only serves the files and forwards the jev calls, because the typesafe api does not send cors headers. your key goes to api.typesafe.ai and nowhere else.

## controls

wasd move, mouse aim, hold click to fire, tab for the agent view.

## files

- `game.js` the arena: units, walls, projectiles, medkits. `observe(id)` and `act(id, command)` are the player api.
- `nav.js` grid a*, cover search, retreat and flank sampling.
- `agent.js` the jev agent: candidates, descriptions, one choice per decision, execution.
- `jev.js` the api call.
- `render.js` three.js scene, effects, sounds, agent overlay.
- `index.html` input, waves, hud, agent inspector.
- `server.mjs` static files plus the api passthrough.

the doctrine the bots follow is one string at the top of `agent.js`. change it and the bots change.
