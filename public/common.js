
  function dropdown(id, event) {
    event.preventDefault();
    
    // Close all other dropdowns
    document.querySelectorAll('.dropdown').forEach(d => {
      if (d.id !== id) d.style.display = 'none';
    });

    // Toggle the clicked one
    const el = document.getElementById(id);
    el.style.display = el.style.display === "flex" ? "none" : "flex";
  }

