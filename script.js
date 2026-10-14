function switchView(viewId) {
    // Verstecke alle Views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    
    // Zeige die gewünschte View an
    document.getElementById(viewId).classList.remove('hidden');
}
