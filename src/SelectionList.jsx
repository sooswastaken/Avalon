import React from "react";
import { LayoutGroup, motion } from "framer-motion";

export default function SelectionList({
  availableItems,
  selectedItems,
  onAdd,
  onRemove,
  labelAvailable = "Available",
  labelSelected = "Selected",
}) {
  return (
    <LayoutGroup>
      <div className="selection-container">
        {/* Available List */}
        <div className="selection-list">
          <h3>{labelAvailable}</h3>
          <div className="items-grid">
            {availableItems.map((item) => (
              <motion.div
                key={item.id}
                layout
                layoutId={`item-${item.id}`} // ensure consistent layoutId
                className="card-item"
                onClick={() => onAdd(item)}
                whileHover={{ scale: 1.05 }}
              >
                <img src={item.img} alt={item.name} />
                <p>{item.name}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Selected List */}
        <div className="selection-list">
          <h3>{labelSelected}</h3>
          <div className="items-grid">
            {selectedItems.map((item) => (
              <motion.div
                key={item.id}
                layout
                layoutId={`item-${item.id}`}
                className="card-item"
                onClick={() => onRemove(item)}
                whileHover={{ scale: 1.05 }}
              >
                <img src={item.img} alt={item.name} />
                <p>{item.name}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </LayoutGroup>
  );
}
