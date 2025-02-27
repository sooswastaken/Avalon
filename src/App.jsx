import React, { useState, useEffect } from "react";
import { motion, animate, useMotionValue } from "framer-motion";
import SelectionList from "./SelectionList";
import "./App.scss";

// ---------- ROLES ----------
const ALL_ROLES = [
  { id: "merlin",    name: "Merlin",       img: "/assets/cards/merlin.png",   alignment: "good", required: true },
  { id: "mordred",   name: "Mordred",      img: "/assets/cards/mordred.png",  alignment: "evil", required: true },
  { id: "percival",  name: "Percival",     img: "/assets/cards/percival.png", alignment: "good" },
  { id: "morgana",   name: "Morgana",      img: "/assets/cards/morgana.png",  alignment: "evil" },
  { id: "assassin",  name: "Assassin",     img: "/assets/cards/assassin.png", alignment: "evil" },
  { id: "oberon",    name: "Oberon",       img: "/assets/cards/oberon.png",   alignment: "evil" },
  { id: "minion1",   name: "Minion of Mordred", img: "/assets/cards/minion.png", alignment: "evil" },
  { id: "minion2",   name: "Minion of Mordred", img: "/assets/cards/minion.png", alignment: "evil" },
  { id: "minion3",   name: "Minion of Mordred", img: "/assets/cards/minion.png", alignment: "evil" },
  { id: "servant1",  name: "Loyal Servant of Arthur", img: "/assets/cards/servant.png", alignment: "good" },
  { id: "servant2",  name: "Loyal Servant of Arthur", img: "/assets/cards/servant.png", alignment: "good" },
  { id: "servant3",  name: "Loyal Servant of Arthur", img: "/assets/cards/servant.png", alignment: "good" },
  { id: "servant4",  name: "Loyal Servant of Arthur", img: "/assets/cards/servant.png", alignment: "good" },
  { id: "servant5",  name: "Loyal Servant of Arthur", img: "/assets/cards/servant.png", alignment: "good" },
];

// ---------- FRIENDS ----------
const FRIENDS = [
  { id: 1, name: "Soos",   img: "/assets/friends/soos.png"   },
  { id: 2, name: "Eric",   img: "/assets/friends/eric.png"   },
  { id: 3, name: "Saugat", img: "/assets/friends/saugat.png" },
  { id: 4, name: "Jin",    img: "/assets/friends/jin.png"    },
  { id: 5, name: "Josiah", img: "/assets/friends/josiah.png" },
  { id: 6, name: "Raggav", img: "/assets/friends/raggav.png" },
  { id: 7, name: "Tanner", img: "/assets/friends/tanner.png" },
  { id: 8, name: "Gautam", img: "/assets/friends/gautam.png" },
];

function App() {
  const [step, setStep] = useState(1);

  // FRIENDS
  const [availableFriends, setAvailableFriends] = useState(FRIENDS);
  const [selectedFriends, setSelectedFriends] = useState([]);

  // ROLES
  const [availableRoles, setAvailableRoles] = useState(ALL_ROLES);
  const [selectedRoles, setSelectedRoles] = useState([]);

  // Reveal
  const [revealOrder, setRevealOrder] = useState([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [showCard, setShowCard] = useState(false);

  // "Revealed" sound
  const revealedAudio = new Audio("/assets/sounds/revealed.mp3");

  // Motion value for the swipe handle
  const swipeX = useMotionValue(0);

  useEffect(() => {
    // On mount, ensure Merlin & Mordred are selected
    const merlin = ALL_ROLES.find((r) => r.id === "merlin");
    const mordred = ALL_ROLES.find((r) => r.id === "mordred");

    setSelectedRoles((prev) => {
      const newArr = [...prev];
      if (!newArr.find((r) => r.id === "merlin")) newArr.push(merlin);
      if (!newArr.find((r) => r.id === "mordred")) newArr.push(mordred);
      return newArr;
    });

    setAvailableRoles((prev) =>
      prev.filter((r) => r.id !== "merlin" && r.id !== "mordred")
    );
  }, []);

  // --------------------
  // FRIENDS SELECTION
  // --------------------
  const handleAddFriend = (friend) => {
    setAvailableFriends((prev) => prev.filter((f) => f.id !== friend.id));
    setSelectedFriends((prev) => [...prev, friend]);
  };
  const handleRemoveFriend = (friend) => {
    setSelectedFriends((prev) => prev.filter((f) => f.id !== friend.id));
    setAvailableFriends((prev) => [...prev, friend]);
  };

  // --------------------
  // ROLES SELECTION
  // --------------------
  const handleAddRole = (role) => {
    if (selectedRoles.some((r) => r.id === role.id)) return;
    setAvailableRoles((prev) => prev.filter((r) => r.id !== role.id));
    setSelectedRoles((prev) => [...prev, role]);

    // If we add Morgana => also add Percival
    if (role.id === "morgana") {
      const percival = ALL_ROLES.find((r) => r.id === "percival");
      const hasPercival = [...selectedRoles, role].some((r) => r.id === "percival");
      if (percival && !hasPercival) {
        setAvailableRoles((prev) => prev.filter((r) => r.id !== "percival"));
        setSelectedRoles((prev) => [...prev, percival]);
      }
    }
    // If we add Percival => also add Morgana
    if (role.id === "percival") {
      const morgana = ALL_ROLES.find((r) => r.id === "morgana");
      const hasMorgana = [...selectedRoles, role].some((r) => r.id === "morgana");
      if (morgana && !hasMorgana) {
        setAvailableRoles((prev) => prev.filter((r) => r.id !== "morgana"));
        setSelectedRoles((prev) => [...prev, morgana]);
      }
    }
  };

  const handleRemoveRole = (roleId) => {
    const roleObj = selectedRoles.find((r) => r.id === roleId);
    if (!roleObj) return;
    if (roleObj.required) return; // cannot remove required roles

    setSelectedRoles((prev) => prev.filter((r) => r.id !== roleId));
    setAvailableRoles((prev) => [...prev, roleObj]);

    if (roleId === "morgana") {
      // Removing Morgana => remove Percival
      const percivalIn = selectedRoles.find((r) => r.id === "percival");
      if (percivalIn && !percivalIn.required) {
        setSelectedRoles((prev) => prev.filter((r) => r.id !== "percival"));
        setAvailableRoles((prev) => [...prev, percivalIn]);
      }
    }
    if (roleId === "percival") {
      // Removing Percival => remove Morgana
      const morganaIn = selectedRoles.find((r) => r.id === "morgana");
      if (morganaIn && !morganaIn.required) {
        setSelectedRoles((prev) => prev.filter((r) => r.id !== "morgana"));
        setAvailableRoles((prev) => [...prev, morganaIn]);
      }
    }
  };

  // --------------------
  // NAVIGATION
  // --------------------
  const handleDoneFriends = () => {
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDoneRoles = () => {
    setStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Shuffle & assign roles
    const needed = selectedFriends.length;
    const rolesShuffled = [...selectedRoles].sort(() => 0.5 - Math.random());
    const finalRoles = rolesShuffled.slice(0, needed);
    const playersShuffled = [...selectedFriends].sort(() => 0.5 - Math.random());

    const pairing = playersShuffled.map((player, i) => ({
      player,
      role: finalRoles[i],
    }));
    setRevealOrder(pairing);
    setCurrentPlayerIndex(0);
  };

  // --------------------
  // REVEAL PHASE
  // --------------------
  const handleDragEnd = (e, info) => {
    if (info.offset.x > 100) {
      // Enough swipe => reveal
      handleRevealSwipe();
    } else {
      animate(swipeX, 0, { type: "spring", stiffness: 300 });
    }
  };

  const handleRevealSwipe = () => {
    revealedAudio.play();
    setShowCard(true);

    // Snap the handle back
    animate(swipeX, 0, { type: "spring", stiffness: 300 });

    // We wait a bit for the DOM to update (the reveal details to mount),
    // then scroll to the bottom so they see the card & known players
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }, 300);
  };

  const handleDoneReveal = () => {
    setShowCard(false);
    swipeX.set(0);

    // Scroll to top so next player starts at the top
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (currentPlayerIndex < revealOrder.length - 1) {
      setCurrentPlayerIndex((prev) => prev + 1);
    } else {
      setStep(4);
    }
  };

  // Which players do I see?
  function getKnownPlayers(roleId) {
    const EVIL_IDS = ["mordred", "morgana", "assassin", "minion1", "minion2", "minion3"];

    if (roleId === "percival") {
      return revealOrder.filter(e => ["merlin","morgana"].includes(e.role.id));
    }
    if (roleId === "merlin") {
      return revealOrder.filter(e => e.role.id === "assassin");
    }
    if (EVIL_IDS.includes(roleId)) {
      // Evil except Oberon => see other Evil except themselves
      return revealOrder.filter(e => EVIL_IDS.includes(e.role.id) && e.role.id !== roleId);
    }
    if (roleId === "oberon") {
      return [];
    }
    // Otherwise, no knowledge
    return [];
  }

  function renderKnowledgeLabel(roleId) {
    const EVIL_IDS = ["mordred","morgana","assassin","minion1","minion2","minion3"];
    if (EVIL_IDS.includes(roleId)) {
      return <h3>Your Teammates</h3>;
    }
    if (roleId === "percival") {
      return <h3>You see Merlin or Morgana:</h3>;
    }
    if (roleId === "merlin") {
      return <h3>You know who the Assassin is:</h3>;
    }
    return null;
  }

  // If Evil or Percival => hide role label, else show
  function shouldShowExactRole(myRoleId) {
    const EVIL_IDS = ["mordred","morgana","assassin","minion1","minion2","minion3","oberon"];
    if (EVIL_IDS.includes(myRoleId)) return false;
    if (myRoleId === "percival") return false;
    return true; // e.g. Merlin or servants
  }

  let currentPair = null;
  let knownPlayers = [];
  if (step === 3 && revealOrder.length > 0) {
    currentPair = revealOrder[currentPlayerIndex];
    knownPlayers = getKnownPlayers(currentPair.role.id);
  }

  return (
    <div className="app-container">
      {/* STEP 1: Select Friends */}
      {step === 1 && (
        <div className="page-container">
          <h1>Select Friends</h1>
          <SelectionList
            availableItems={availableFriends}
            selectedItems={selectedFriends}
            onAdd={handleAddFriend}
            onRemove={handleRemoveFriend}
            labelAvailable="Available Friends"
            labelSelected="Selected Friends"
          />
          <button className="done-button" onClick={handleDoneFriends}>
            Done (Friends)
          </button>
        </div>
      )}

      {/* STEP 2: Select Roles */}
      {step === 2 && (
        <div className="page-container">
          <h1>Select Cards</h1>
          <SelectionList
            availableItems={availableRoles}
            selectedItems={selectedRoles}
            onAdd={handleAddRole}
            onRemove={(role) => handleRemoveRole(role.id)}
            labelAvailable="Available Cards"
            labelSelected="Selected Cards"
          />
          <button className="start-button" onClick={handleDoneRoles}>
            Start Game
          </button>
        </div>
      )}

      {/* STEP 3: Reveal Screen */}
      {step === 3 && currentPair && (
        <div className="reveal-container">
          <h2>Pass the device to:</h2>
          <motion.img
            key={currentPair.player.id}
            src={currentPair.player.img}
            alt={currentPair.player.name}
            className="player-image"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          />

          <div className="swipe-area">
            <p className="swipe-text">Slide to Reveal</p>
            <motion.div
              className="swipe-handle"
              drag="x"
              style={{ x: swipeX }}
              dragConstraints={{ left: 0, right: 250 }}
              onDragEnd={handleDragEnd}
              whileTap={{ scale: 1.02 }}
            >
              <span className="arrow">➔</span>
            </motion.div>
          </div>

          {showCard && (
            <div className="reveal-details">
              <motion.div
                key="card"
                className="card-reveal"
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <img
                  src={currentPair.role.img}
                  alt={currentPair.role.name}
                  className="role-image"
                />
                <p className="role-name">{currentPair.role.name}</p>
              </motion.div>

              {/* Known players */}
              {knownPlayers.length > 0 && (
                <motion.div
                  className="known-players"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  {renderKnowledgeLabel(currentPair.role.id)}
                  <div className="known-players-row">
                    {knownPlayers.map((kp) => (
                      <motion.div
                        key={kp.player.id}
                        className="known-player-card"
                        whileHover={{ scale: 1.05 }}
                      >
                        <img
                          src={kp.player.img}
                          alt={kp.player.name}
                          className="known-player-img"
                        />
                        <p className="known-player-name">{kp.player.name}</p>
                        {shouldShowExactRole(currentPair.role.id) && (
                          <p className="known-role-label">{kp.role.name}</p>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              <button className="done-button" onClick={handleDoneReveal}>
                Done
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 4: All Done */}
      {step === 4 && (
        <div className="page-container">
          <h1>All roles revealed! Enjoy your game!</h1>
        </div>
      )}
    </div>
  );
}

export default App;
