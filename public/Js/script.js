const userId = localStorage.getItem('heroId');
const pseudo = localStorage.getItem('heroName');

if (!userId && !window.location.href.includes('index.html') && !window.location.href.includes('signup.html')) {
    window.location.href = 'index.html';
}

// --- FONCTIONS COMMUNES ---

// Barre de navigation (injectée automatiquement sur chaque page)
function loadNav() {
    const navHTML = `
    <nav class="bottom-nav">
        <a href="dashboard.html">🏠 Missions</a>
        <a href="create.html">➕ Nouveau</a>
        <a href="shop.html">🛒 Boutique</a>
        <a href="profile.html">👤 Profil</a>
    </nav>`;
    document.body.insertAdjacentHTML('beforeend', navHTML);
}

// Mise à jour du bandeau stats (HP, Gold, XP)
async function updateStatsHeader() {
    const res = await fetch('/api/user/' + userId);
    const data = await res.json();
    if(data.success) {
        const s = data.user.stats;
        const header = document.getElementById('stats-header');
        if(header) {
            header.innerHTML = `
                <div class="stat-box">❤️ ${s.hp}/${s.maxHp}</div>
                <div class="stat-box">🪙 ${s.coins}</div>
                <div class="stat-box">⭐ Nv ${s.level}</div>
                <div class="stat-box">💎 ${s.rubies || 0}</div>
            `;
        }
        return data.user;
    }
}

// --- LOGIQUE PAR PAGE ---

// 1. DASHBOARD (Liste des missions)
async function initDashboard() {
    const user = await updateStatsHeader();
    const list = document.getElementById('task-list');
    list.innerHTML = '';

    if (!user.tasks) {
        list.innerHTML = '<p style="text-align:center; margin-top:20px;">Aucune mission en cours.</p>';
        return;
    }

    Object.entries(user.tasks).forEach(([id, task]) => {
        const item = document.createElement('div');
        item.className = `task-card type-${task.type}`;
        item.innerHTML = `
            <div class="task-info">
                <h3>${task.name}</h3>
                <small>${task.type} | Diff: ${task.difficulty} | Malus: ${task.malusLevel}</small>
                ${task.deadline ? `<br><span style="color:#ff6b6b">📅 ${task.deadline}</span>` : ''}
            </div>
            <div class="task-actions">
                <button onclick="completeTask('${id}')" class="btn-check">✅</button>
                <button onclick="failTask('${id}')" class="btn-fail">💀</button>
            </div>
        `;
        list.appendChild(item);
    });
}

async function completeTask(taskId) {
    const res = await fetch('/api/complete-task', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, taskId })
    });
    const data = await res.json();
    if(data.success) {
        location.reload();
    }
}

async function failTask(taskId) {
    // 1. Confirmation
    if(!confirm("Déclarer l'échec ? Tu vas perdre des PV.")) return;

    try {
        // 2. Appel au serveur
        const res = await fetch('/api/fail-task', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId, taskId })
        });

        // 3. Réponse du serveur
        const data = await res.json();

        if(data.success) {
            location.reload();   // Recharge la page pour mettre à jour
        } else {
            // Si le serveur a dit "Non" (ex: tâche déjà supprimée)
            alert("Erreur : " + data.message);
            location.reload();
        }
    } catch (error) {
        // Si le serveur est éteint ou a planté
        console.error("Erreur JS:", error);
        alert("Impossible de contacter le serveur. Vérifie qu'il tourne bien !");
    }
}

// 2. CRÉATION (Ajout mission)
async function createTask() {
    const data = {
        userId,
        name: document.getElementById('t-name').value,
        type: document.getElementById('t-type').value,
        difficulty: document.getElementById('t-diff').value,
        malusLevel: document.getElementById('t-malus').value,
        deadline: document.getElementById('t-date').value
    };

    if(!data.name) return alert("Il faut un nom !");

    await fetch('/api/create-task', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    window.location.href = 'dashboard.html';
}

// 3. BOUTIQUE (Gestion dynamique)
async function initShop() {
    // 1. Mise à jour stats
    const user = await updateStatsHeader();
    
    // 2. Récupérer la liste des items perso
    const container = document.getElementById('custom-shop-list');
    container.innerHTML = ''; // On vide

    if (user.shop) {
        Object.entries(user.shop).forEach(([id, item]) => {
            const div = document.createElement('div');
            div.className = 'shop-item';
            div.onclick = () => buyItem(item.name, item.price, false, id); // On passe l'ID
            div.innerHTML = `
                <span>🎁 ${item.name}</span>
                <span style="color:gold">${item.price} 🪙</span>
            `;
            container.appendChild(div);
        });
    } else {
        container.innerHTML = '<p style="color:#666; font-size:0.7rem;">Aucune récompense perso créée.</p>';
    }
}

async function createShopItem() {
    const name = document.getElementById('s-name').value;
    const price = document.getElementById('s-price').value;

    if(!name || !price) return alert("Remplis le nom et le prix !");

    await fetch('/api/create-shop-item', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, name, price })
    });
    
    // On vide les champs et on recharge
    document.getElementById('s-name').value = '';
    document.getElementById('s-price').value = '';
    initShop();
}

async function buyItem(name, price, isPotion, itemId = null) {
    if(!confirm(`Acheter "${name}" pour ${price} pièces ?`)) return;

    const res = await fetch('/api/buy', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, itemName: name, price, isPotion, itemId })
    });
    const data = await res.json();
    alert(data.message);
    if(data.success) location.reload();
}

// Initialisation globale
loadNav();
if(document.getElementById('task-list')) initDashboard();
if(document.getElementById('stats-header')) updateStatsHeader();
if(document.getElementById('custom-shop-list')) initShop(); // Lancer le shop si on est sur la page