import { useEffect, useState } from "react";
import "./wiki.css";
export default function Wiki() {
  const [expanded, setExpanded] = useState(
    () =>
      new Set(
        (new URLSearchParams(location.search).get("item") || "")
          .toLowerCase()
          .split(",")
          .map((s) => s.trim()),
      ),
  );
  const toggle = (key) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  useEffect(() => {
    document.title = "Avalon - Wiki";
    const key = (new URLSearchParams(location.search).get("item") || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (key)
      document.getElementById(key)?.scrollIntoView?.({ block: "center" });
  }, []);
  return (
    <>
      <header>
        <h1>The Resistance: Avalon Wiki</h1>
      </header>

      <main>
        <section id="overview" className="card">
          <div className="card-header-container">
            <h2>Game Overview</h2>
            <a href="#characters" className="jump-button">
              Jump to Roles &raquo;
            </a>
          </div>
          <p>
            The Resistance: Avalon is a hidden-role social deduction game set in
            Arthurian legend. Players are secretly divided into two sides: the{" "}
            <strong>Loyal Servants of Arthur</strong> (the{" "}
            <span className="good">Good</span> team) and the{" "}
            <strong>Minions of Mordred</strong> (the{" "}
            <span className="evil">Evil</span> team). The{" "}
            <span className="good">Good</span> team wins by successfully
            completing three Quests, while the{" "}
            <span className="evil">Evil</span> team wins by sabotaging three
            Quests or by the evil team assassinating Merlin.
          </p>

          <h3>Core Mechanics</h3>
          <p>
            All players must keep their roles secret. Open discussion,
            deception, and accusation are central to the game. No one may reveal
            their role card to others.
          </p>

          <h3>Game Setup and Roles</h3>
          <p>
            Avalon supports 5 to 10 players, with a specific mix of{" "}
            <span className="good">Good</span> and{" "}
            <span className="evil">Evil</span> roles for balance. At the start,
            each player is dealt a hidden character card determining their
            loyalty and any special ability. The number of{" "}
            <span className="evil">Evil</span> players increases with higher
            player counts (e.g., 5 players = 2{" "}
            <span className="evil">Evil</span>; 7 players = 3{" "}
            <span className="evil">Evil</span>; 10 players = 4{" "}
            <span className="evil">Evil</span>).
          </p>

          <h3>Initial Information (Night Phase)</h3>
          <p>
            After roles are assigned, a scripted "night" phase is carried out
            with everyone's eyes closed, during which certain players gain
            information about others:
          </p>
          <ul>
            <li>
              <strong>
                <span className="evil">Evil</span> Reveal:
              </strong>{" "}
              All <span className="evil">Evil</span> players (except Oberon)
              open their eyes to recognize each other.
            </li>
            <li>
              <strong>Merlin's Knowledge:</strong> The{" "}
              <span className="evil">Evil</span> players (except Mordred and
              Oberon) make themselves known to Merlin. Merlin learns who is{" "}
              <span className="evil">Evil</span>, but does not learn Mordred's
              identity.
            </li>
            <li>
              <strong>Percival's Knowledge:</strong> If in play, Merlin and
              Morgana make themselves known to Percival, who sees both but does
              not know which is the true Merlin.
            </li>
          </ul>

          <h3>Gameplay Phases</h3>
          <p>
            Each round consists of a <strong>Team Building</strong> phase and a{" "}
            <strong>Quest</strong> phase.
          </p>
          <ul>
            <li>
              <strong>Team Building:</strong> The current Leader proposes a team
              to go on a Quest. All players vote to approve or reject the team.
              If five teams in a row are rejected,{" "}
              <span className="evil">Evil</span> wins.
            </li>
            <li>
              <strong>Quest Phase:</strong> If the team is approved, the
              selected players secretly choose to either{" "}
              <strong>Succeed</strong> or <strong>Fail</strong> the Quest.{" "}
              <span className="good">Good</span> players must choose Success.{" "}
              <span className="evil">Evil</span> players can choose either. If
              even one Fail card is played (with some exceptions in larger
              games), the Quest fails.
            </li>
          </ul>

          <h3>Victory Conditions</h3>
          <ul>
            <li>
              <strong>
                <span className="evil">Evil</span> Wins:
              </strong>{" "}
              The <span className="evil">Evil</span> team wins if three Quests
              fail OR if five consecutive teams are rejected.
            </li>
            <li>
              <strong>
                <span className="good">Good</span> Wins:
              </strong>{" "}
              The <span className="good">Good</span> team wins if three Quests
              succeed AND Merlin is not evil teamated.
            </li>
            <li>
              <strong>The evil teamation:</strong> If{" "}
              <span className="good">Good</span> succeeds on three Quests, the
              player with the evil team role gets one chance to correctly
              identify and name the player who is Merlin. If they are correct,{" "}
              <span className="evil">Evil</span> steals the victory. If they are
              wrong, <span className="good">Good</span> wins.
            </li>
          </ul>
        </section>

        <section id="characters" className="card">
          <h2>Characters & Roles</h2>
          <div className="character-grid">
            <div
              className={`character-card ${expanded.has("merlin") ? "expanded" : ""}`}
              id="merlin"
              data-character="merlin"
            >
              <button
                type="button"
                className="character-header"
                aria-expanded={expanded.has("merlin")}
                onClick={() => toggle("merlin")}
              >
                <img src="/images/merlin.png" alt="Merlin" />
                <h3>Merlin</h3>
                <div className="expand-icon">+</div>
              </button>
              <div className="character-details">
                <h4>
                  SIDE: <span className="good">GOOD</span>
                </h4>
                <p>
                  You know which players are <span className="evil">Evil</span>,
                  except Mordred, or Oberon, who are hidden from you. You must
                  guide the <span className="good">Good</span> team to victory
                  without revealing your identity, as the evil team can steal
                  the win by naming you at the end of the game.
                </p>
                <h4>Tips & Tricks</h4>
                <ul>
                  <li>
                    <strong>Subtlety is Key:</strong> Don't immediately reject
                    every team with an <span className="evil">Evil</span>{" "}
                    player. This makes you too obvious. Sometimes you have to
                    approve a team with one <span className="evil">Evil</span>{" "}
                    player (especially on early quests) to hide.
                  </li>
                  <li>
                    <strong>Signal with Votes:</strong> Use your approval votes
                    to signal information. Approving a clean team
                    enthusiastically and rejecting a bad team with a sigh can
                    communicate a lot without words.
                  </li>
                  <li>
                    <strong>"Merlin-Speak":</strong> Develop ways to talk that
                    guide your team. Phrases like "I'm not sure about this team,
                    but I'm willing to risk it," or "I have a much better
                    feeling about this proposal" can steer the conversation.
                  </li>
                  <li>
                    <strong>
                      Watch the <span className="evil">Evil</span> Players:
                    </strong>{" "}
                    You know who most of them are. Watch how they vote and who
                    they accuse. This helps you identify their strategies and
                    find Mordred.
                  </li>
                </ul>
              </div>
            </div>

            <div
              className={`character-card ${expanded.has("percival") ? "expanded" : ""}`}
              id="percival"
              data-character="percival"
            >
              <button
                type="button"
                className="character-header"
                aria-expanded={expanded.has("percival")}
                onClick={() => toggle("percival")}
              >
                <img src="/images/percival.png" alt="Percival" />
                <h3>Percival</h3>
                <div className="expand-icon">+</div>
              </button>
              <div className="character-details">
                <h4>
                  SIDE: <span className="good">GOOD</span>
                </h4>
                <p>
                  During the night phase, you see the two players who are Merlin
                  and Morgana, but you don't know which is which. Your job is to
                  identify the true Merlin and protect them, while exposing the
                  imposter.
                </p>
                <h4>Tips & Tricks</h4>
                <ul>
                  <li>
                    <strong>The 50/50 Problem:</strong> Your primary goal is to
                    solve the Merlin/Morgana puzzle. Listen closely to how both
                    players talk. Morgana will try to act wise, but may slip up.
                    Merlin will be knowledgeable but cautious.
                  </li>
                  <li>
                    <strong>Propose Test Teams:</strong> As leader, consider
                    putting both your suspects on an early, small quest (like a
                    2-person team). See how they react and how others vote. If
                    the quest fails, you've narrowed it down.
                  </li>
                  <li>
                    <strong>Become a Beacon:</strong> Once you are confident you
                    know who Merlin is, your job is to protect them and subtly
                    draw fire away from them. Make yourself a target for the
                    evil team if you have to.
                  </li>
                  <li>
                    <strong>Trust Your Gut:</strong> Sometimes the only
                    information you have is how players carry themselves.
                    Morgana might be too eager to lead, while Merlin might be
                    more reserved.
                  </li>
                </ul>
              </div>
            </div>

            <div
              className={`character-card ${expanded.has("loyalservantofarthur") ? "expanded" : ""}`}
              id="loyalservantofarthur"
              data-character="loyalservantofarthur"
            >
              <button
                type="button"
                className="character-header"
                aria-expanded={expanded.has("loyalservantofarthur")}
                onClick={() => toggle("loyalservantofarthur")}
              >
                <img
                  src="/images/loyalservantofarthur.png"
                  alt="Loyal Servant"
                />
                <h3>Loyal Servant</h3>
                <div className="expand-icon">+</div>
              </button>
              <div className="character-details">
                <h4>
                  SIDE: <span className="good">GOOD</span>
                </h4>
                <p>
                  You are a standard member of the{" "}
                  <span className="good">Good</span> team. You have no special
                  knowledge. You must use logic, observation, and deduction to
                  identify your allies and root out the{" "}
                  <span className="evil">Evil</span> players. You must always
                  play a Success card on quests.
                </p>
                <h4>Tips & Tricks</h4>
                <ul>
                  <li>
                    <strong>Track the Votes:</strong> The most powerful
                    information you have is the voting record. Keep track of who
                    proposes which teams and who approves/rejects them. A string
                    of rejections can often point to{" "}
                    <span className="evil">Evil</span> players trying to get
                    their allies on a team.
                  </li>
                  <li>
                    <strong>Listen Carefully:</strong> Pay attention to
                    accusations. Is someone being accused for a good reason, or
                    is it an <span className="evil">Evil</span> player trying to
                    frame a <span className="good">Good</span> one?
                  </li>
                  <li>
                    <strong>Think Like Merlin:</strong> Try to figure out who
                    Merlin might be and what they would be trying to
                    communicate. If a team that looks good is rejected, ask why.
                    There might be a hidden <span className="evil">Evil</span>{" "}
                    player on it that only Merlin can see.
                  </li>
                </ul>
              </div>
            </div>

            <div
              className={`character-card ${expanded.has("mordred") ? "expanded" : ""}`}
              id="mordred"
              data-character="mordred"
            >
              <button
                type="button"
                className="character-header"
                aria-expanded={expanded.has("mordred")}
                onClick={() => toggle("mordred")}
              >
                <img src="/images/mordred.png" alt="Mordred" />
                <h3>Mordred</h3>
                <div className="expand-icon">+</div>
              </button>
              <div className="character-details">
                <h4>
                  SIDE: <span className="evil">EVIL</span>
                </h4>
                <p>
                  You are the leader of the <span className="evil">Evil</span>{" "}
                  team. You know who your fellow minions are, but you are
                  completely hidden from Merlin. This is your greatest strength.
                </p>
                <h4>Tips & Tricks</h4>
                <ul>
                  <li>
                    <strong>
                      Act <span className="good">Good</span>:
                    </strong>{" "}
                    Your goal is to appear as a trustworthy Loyal Servant. Vote
                    for what seem like "good" teams. Talk logically. Build trust
                    so that you can get on a late-game quest and fail it.
                  </li>
                  <li>
                    <strong>Leverage Your Invisibility:</strong> Since Merlin
                    doesn't know you, you can sometimes agree with Merlin's
                    logic or even "help" the good team early on to solidify your
                    cover.
                  </li>
                  <li>
                    <strong>Coordinate Silently:</strong> Use your votes to
                    signal to your fellow minions. If you approve a team with
                    another <span className="evil">Evil</span> player, they know
                    you trust them to make the right play (succeed or fail).
                  </li>
                  <li>
                    <strong>Don't Be Afraid to Succeed:</strong> Playing a
                    "Success" card, especially on a quest with another known{" "}
                    <span className="evil">Evil</span> player, can sow immense
                    confusion and make you look incredibly{" "}
                    <span className="good">Good</span>.
                  </li>
                </ul>
              </div>
            </div>

            <div
              className={`character-card ${expanded.has("morgana") ? "expanded" : ""}`}
              id="morgana"
              data-character="morgana"
            >
              <button
                type="button"
                className="character-header"
                aria-expanded={expanded.has("morgana")}
                onClick={() => toggle("morgana")}
              >
                <img src="/images/morgana.png" alt="Morgana" />
                <h3>Morgana</h3>
                <div className="expand-icon">+</div>
              </button>
              <div className="character-details">
                <h4>
                  SIDE: <span className="evil">EVIL</span>
                </h4>
                <p>
                  You appear to Percival as if you might be Merlin. Your mission
                  is to confuse Percival for as long as possible, making him
                  mistrust the real Merlin and potentially protect you instead.
                </p>
                <h4>Tips & Tricks</h4>
                <ul>
                  <li>
                    <strong>Mimic Merlin:</strong> Try to act wise and
                    thoughtful, but be careful not to overdo it. Make
                    logical-sounding arguments. If you can figure out who
                    Percival is, you can direct your performance at him.
                  </li>
                  <li>
                    <strong>Sow Discord:</strong> Subtly accuse the real Merlin.
                    Say things like, "I think [Merlin's Player Name] is acting
                    suspicious. They're trying too hard to lead us." This can
                    make Percival doubt.
                  </li>
                  <li>
                    <strong>Identify Percival:</strong> The player who seems to
                    be staring intently at you and one other person at the start
                    of the game is likely Percival. Use this knowledge to your
                    advantage.
                  </li>
                  <li>
                    <strong>Work with the evil team:</strong> If you can confuse
                    Percival into outing the real Merlin, you make the evil
                    team's job trivial.
                  </li>
                </ul>
              </div>
            </div>

            <div
              className={`character-card ${expanded.has("oberon") ? "expanded" : ""}`}
              id="oberon"
              data-character="oberon"
            >
              <button
                type="button"
                className="character-header"
                aria-expanded={expanded.has("oberon")}
                onClick={() => toggle("oberon")}
              >
                <img src="/images/oberon.png" alt="Oberon" />
                <h3>Oberon</h3>
                <div className="expand-icon">+</div>
              </button>
              <div className="character-details">
                <h4>
                  SIDE: <span className="evil">EVIL</span>
                </h4>
                <p>
                  You are on the <span className="evil">Evil</span> team, but
                  you are a mystery to everyone. You do not know who the other{" "}
                  <span className="evil">Evil</span> players are, and they do
                  not know who you are. Merlin also does not know you are{" "}
                  <span className="evil">Evil</span>. You are a true wildcard.
                </p>
                <h4>Tips & Tricks</h4>
                <ul>
                  <li>
                    <strong>Create Chaos:</strong> Your actions will be
                    unpredictable to both teams. You can fail a quest that the
                    other <span className="evil">Evil</span> players thought was
                    safe, or succeed on one they wanted to fail. Use this to
                    your advantage.
                  </li>
                  <li>
                    <strong>
                      Appear as a bad <span className="good">Good</span> player:
                    </strong>{" "}
                    Your voting patterns might seem illogical because you don't
                    have inside information. Lean into this. Act like a confused
                    Loyal Servant who is bad at the game.
                  </li>
                  <li>
                    <strong>When to Fail:</strong> Failing a quest as Oberon is
                    a powerful but risky move. It's best done when you are on a
                    team with only known <span className="good">Good</span>{" "}
                    players, as it casts suspicion on all of them and creates
                    maximum confusion.
                  </li>
                  <li>
                    <strong>Hidden from Merlin:</strong> Like Mordred, Merlin
                    can't see you. This makes you a prime candidate to get on a
                    "Merlin-approved" team and unexpectedly fail it.
                  </li>
                </ul>
              </div>
            </div>

            <div
              className={`character-card ${expanded.has("minionofmordred") ? "expanded" : ""}`}
              id="minionofmordred"
              data-character="minionofmordred"
            >
              <button
                type="button"
                className="character-header"
                aria-expanded={expanded.has("minionofmordred")}
                onClick={() => toggle("minionofmordred")}
              >
                <img src="/images/minionofmordred.png" alt="EVIL" />
                <h3>MINION OF MORDRED</h3>
                <div className="expand-icon">+</div>
              </button>
              <div className="character-details">
                <h4>
                  SIDE: <span className="evil">EVIL</span>
                </h4>
                <p>
                  You are a standard member of the{" "}
                  <span className="evil">Evil</span> team. You know who your
                  fellow minions are (except Oberon). Your job is to sabotage
                  quests, protect your leader Mordred, and help the evil team
                  identify Merlin.
                </p>
                <h4>Tips & Tricks</h4>
                <ul>
                  <li>
                    <strong>The "Hammer":</strong> In 5-player games, one{" "}
                    <span className="evil">Evil</span> player is often
                    designated the "hammer" who should fail almost every quest
                    they're on, while the other (often Mordred) builds trust.
                  </li>
                  <li>
                    <strong>Strategic Success:</strong> Don't just fail every
                    quest. Playing a Success card can build your credibility and
                    make it easier for you to get on a crucial late-game quest.
                  </li>
                  <li>
                    <strong>
                      Frame the <span className="good">Good</span> Guys:
                    </strong>{" "}
                    If you are on a failed quest with two{" "}
                    <span className="good">Good</span> players, immediately and
                    confidently accuse one of them. The more conviction you
                    have, the more believable you are.
                  </li>
                  <li>
                    <strong>Find Merlin:</strong> Listen for players who seem to
                    know too much. A player who consistently rejects bad teams
                    for no obvious reason is a prime suspect for being Merlin.
                    Relay this suspicion to your evil team.
                  </li>
                </ul>
              </div>
            </div>

            <div
              className={`character-card ${expanded.has("ladyofthelake") ? "expanded" : ""}`}
              id="ladyofthelake"
              data-character="ladyofthelake"
            >
              <button
                type="button"
                className="character-header"
                aria-expanded={expanded.has("ladyofthelake")}
                onClick={() => toggle("ladyofthelake")}
              >
                <img src="/images/ladyofthelake.png" alt="Lady of the Lake" />
                <h3>Lady of the Lake</h3>
                <div className="expand-icon">+</div>
              </button>
              <div className="character-details">
                <h4>Special Card (Optional)</h4>
                <p>
                  The Lady of the Lake is a special token, not a player role.
                  Starting after Quest 2, the player holding the token must
                  choose another player to investigate. That player must
                  privately reveal their alignment (
                  <span className="good">Good</span> or{" "}
                  <span className="evil">Evil</span>) to the holder. The token
                  is then passed to the investigated player. This continues
                  after each quest.
                </p>
                <h4>Tips & Tricks</h4>
                <ul>
                  <li>
                    <strong>For the Holder:</strong> Investigate quiet players
                    or players who have made a pivotal, suspicious vote. Don't
                    waste it on someone who is obviously{" "}
                    <span className="good">Good</span> or{" "}
                    <span className="evil">Evil</span>. Announcing the result
                    can be powerful, but lying about it (if you are{" "}
                    <span className="evil">Evil</span>) is even more so.
                  </li>
                  <li>
                    <strong>For the Investigated:</strong> You must tell the
                    truth about your alignment. However, the holder might lie to
                    the group. If you are <span className="good">Good</span> and
                    the <span className="evil">Evil</span> holder claims you are{" "}
                    <span className="evil">Evil</span>, you have just found a
                    definite <span className="evil">Evil</span> player.
                  </li>
                  <li>
                    <strong>Control is Key:</strong> The{" "}
                    <span className="evil">Evil</span> team's goal should be to
                    gain control of the token so they can lie about the results
                    and frame <span className="good">Good</span> players. The{" "}
                    <span className="good">Good</span> team needs to keep it in
                    trusted hands.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
