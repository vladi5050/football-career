# Variety system (summary of design doc)
Events are built from parts: WHO (12 character types: coach, agent, father, rival, journalist, teammate...) x WHAT (25 actions: asks, threatens, offers, tells a secret, apologises) x TOPIC (20: minutes, money, injury, transfer, family) x CONTEXT (10: after loss, before derby, transfer window).
7 mechanisms:
1. Templates with holes: "[who] [does what] because [reason from the past]". Reason pulled from history -> "because in week X..." line on every event screen.
2. Every character has 3 traits of ~15 (hot tempered, loyal, greedy, grateful, prefers youth, hates press...). Same event ends differently by traits.
3. Memory + relations: score -100..100, up to 5 memories per character; memories travel with the person across roles.
4. Consequence chains: a decision triggers a new event 3, 10 or 40 weeks later.
5. Living world: all clubs play, buy, sack managers, get relegated. Results, table, sackings early.
6. Season themes: 2 of ~20 drawn per season (relegation fight, World Cup, new owner, star signing, financial crisis, wedding/baby). Shift event mix.
7. Anti repetition: same template not within 12 weeks; same exact text never twice per career (3-5 variants); category counter (3 money events in a row -> next is different); silence ~1 in 3 weeks.
Prototype scope: 30 templates x 3 variants, 6 traits, memory for coach/agent/rival, 5 short chains, 4 season themes, full anti-repeat.
Scale target: ~900 clubs/40 leagues eventually; prototype 3 leagues ~50 clubs. Crest generator: shape(6) x division(10) x palette(14) x charge(11, star, tower, anchor, initials...). Crest colours follow club colours. Real crests NEVER shipped. Team editor imports a local JSON with user's own names/images, never uploaded.
~120 decision types in 8 domains; each session shows 2-3 relevant decisions. Unlock by age/status.
World seed shareable with friends.

# Beta critique (5 simulated players) -> applied fixes
- Too many screens between matches -> "fast week" (שבוע מהיר) button: repeats last week plan and jumps straight to the match. "World reacts" screen only after a notable match. Target: a match every 90 seconds.
- Key moments repetitive -> 6-8 moment kinds per position, context changes them (minute 90, hostile away crowd, rival facing you, rain).
- Agent revealed exact ceiling -> agent gives a RANGE (e.g. 8-11k), width depends on agent (mentor ±10%, shark ±20% biased up, uncle ±30%).
- Unrealistic salaries -> 17yo in Leumit: asks 9,500 NIS/month, offer 7,000. Release clause 1-2M NIS. Wage table per league and age in data.
- Fake names -> team editor reachable from main menu with names file import.
- Mid career boring -> at least one crisis per season (coach doesn't rate you at 26, injury, relegation) with 3 choices; goals for 28+: captain, mentor a youngster, return home.
- Handwritten font (Amatic SC) only >= 26px and only short notes. Important info always in Assistant.
- "Meanwhile in the league" line (transfers, sackings) at end of each week.
- First kick within 60 seconds of opening the game. Every week ends on an open loop. Visible near-goals ("1 more to dribbling 50").
Characters from designs: rival אלון שושן (מכבי הכרמל), agent מיכל אורן. Clubs: בית״ר הגליל, הפועל נמל, מכבי הכרמל. 3 agents archetypes: shark (כריש), mentor (מנטורית), uncle (דוד).
