import { Modal } from "./components.jsx";

export default function GameExplanation({ onClose }) {
  return (
    <Modal title="How to play Avalon" onClose={onClose}>
      <div className="game-explanation">
        <p className="game-explanation-intro">
          <strong>A secret team game for 5–10 friends.</strong> Good wants to
          help. Evil pretends to help! Your secret role tells you your side.
          Keep it hidden. Talk, ask questions, and decide who to trust.
        </p>
        <h3>Each quest is a little adventure</h3>
        <ol>
          <li>
            <strong>Pick a team.</strong> The leader picks who goes. The screen
            shows how many people to pick. The leader can pick themselves.
          </li>
          <li>
            <strong>Everyone votes.</strong> Approve means “yes,” Reject means
            “no.” More than half must say yes. A tie means no! If no, the next
            leader tries. Five rejected teams in a row means Evil wins.
            Approving a team resets that count.
          </li>
          <li>
            <strong>The team plays secret cards.</strong> Only picked players
            play. Good must pick Success. Evil can pick Success or Fail. One
            Fail spoils the quest, except quest 4 with 7 or more players needs
            two Fails. You see how many Fails, never who played them.
          </li>
          <li>
            <strong>Pass the leader turn.</strong> After a quest, the next person
            leads. Watch the teams, votes, and results for clues. A Success
            does not prove everyone on that team is Good!
          </li>
        </ol>
        <h3>How does my side win?</h3>
        <p>
          <strong>Evil wins with 3 failed quests.</strong> After 3 successful
          quests, Good has one last test: all Evil players vote for a Good
          player they think is Merlin. The person with the most votes is their
          guess; ties vote again using only the tied names. Find Merlin? Evil
          wins. Guess anyone else? Good wins!
        </p>
        <h3>Who knows what?</h3>
        <ul>
          <li><strong>Merlin · Good:</strong> Sees Evil, except Mordred and Oberon. Help quietly so Evil cannot find you.</li>
          <li><strong>Loyal Servant · Good:</strong> Starts knowing only their own side. Look for clues!</li>
          <li><strong>Mordred · Evil:</strong> Hidden from Merlin.</li>
          <li><strong>Minion of Mordred · Evil:</strong> Helps spoil quests.</li>
          <li><strong>Percival · Good, optional:</strong> Sees Merlin and Morgana, but cannot tell which is which.</li>
          <li><strong>Morgana · Evil, optional:</strong> Looks like Merlin to Percival. These two roles come together.</li>
          <li><strong>Oberon · Evil, optional with 7+ players:</strong> Does not know the other Evil players; they and Merlin do not see Oberon.</li>
        </ul>
        <p>Evil players know each other, except Oberon. Merlin and Mordred are always in the game.</p>
        <h3>One extra rule: Lady of the Lake</h3>
        <p>
          If the host turns it on, the holder checks one person after the quests
          the host chose, while the game is still going. Only the holder learns
          “Good” or “Evil,” not the role. They may tell the truth or pretend!
          The checked person gets the Lady next. You cannot check yourself or
          anyone who has already held it.
        </p>
        <p className="game-explanation-tip">
          <strong>Ready?</strong> Join a room and press Ready. The host starts
          when everyone is ready. The screen tells you when it is your turn.
        </p>
      </div>
    </Modal>
  );
}
