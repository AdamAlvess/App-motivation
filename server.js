const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const crypto = require('crypto');
require('dotenv').config();

const serviceAccount = {
  "type": "service_account",
  "project_id": process.env.FIREBASE_PROJECT_ID,
  "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
  "private_key": process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
  "client_email": process.env.FIREBASE_CLIENT_EMAIL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://real-quest-f8b69-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const app = express();

app.use(bodyParser.json());
app.use(express.static('public'));

// --- CONSTANTES ET RÈGLES DU JEU ---
const REWARDS = {
    1: { min: 1, max: 2, xp: 1 },
    2: { min: 2, max: 3, xp: 2 },
    3: { min: 3, max: 5, xp: 3 },
    4: { min: 5, max: 8, xp: 4 },
    5: { min: 8, max: 12, xp: 6 },
    6: { min: 12, max: 20, xp: 8 },
    7: { min: 20, max: 40, xp: 10 }
};

const MALUS = {
    1: 1, 2: 3, 3: 5, 4: 10, 5: 25, 6: 50, 7: 75
};

const XP_TO_LEVEL_UP = 100;

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function getRandomCoin(min, max) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

// --- ROUTES API ---

// 1. Inscription
app.post('/api/signup', async (req, res) => {
    try {
        const { pseudo, password, infos } = req.body;
        const ref = db.ref('users');
        const snap = await ref.orderByChild('pseudo').equalTo(pseudo).once('value');
        
        if(snap.exists()) return res.json({success:false, message:"Pseudo pris"});
        
        const newUserRef = ref.push();
        await newUserRef.set({
            pseudo, password: hashPassword(password), infos,
            stats: { hp: 100, maxHp: 100, xp: 0, level: 1, coins: 0, rubies: 0 },
            tasks: [], shop: []
        });
        res.json({success:true, userId: newUserRef.key, pseudo});
    } catch (e) {
        console.error(e);
        res.json({success:false, message: "Erreur serveur"});
    }
});

// 2. Connexion
app.post('/api/login', async (req, res) => {
    try {
        const { pseudo, password } = req.body;
        const ref = db.ref('users');
        const snap = await ref.orderByChild('pseudo').equalTo(pseudo).once('value');
        
        if(!snap.exists()) return res.json({success:false, message:"Inconnu"});
        
        const userId = Object.keys(snap.val())[0];
        if(snap.val()[userId].password !== hashPassword(password)) return res.json({success:false});
        
        res.json({success:true, userId, pseudo: snap.val()[userId].pseudo});
    } catch (e) {
        console.error(e);
        res.json({success:false, message: "Erreur serveur"});
    }
});

// 3. Récupérer Infos
app.get('/api/user/:id', async (req, res) => {
    const s = await db.ref('users/' + req.params.id).once('value');
    if (s.exists()) {
        res.json({success: true, user: s.val()});
    } else {
        res.json({success: false, message: "Utilisateur introuvable"});
    }
});

// 4. Créer Tâche
app.post('/api/create-task', async (req, res) => {
    const { userId, name, type, difficulty, malusLevel, deadline } = req.body;
    const newTask = {
        name, type, 
        difficulty: parseInt(difficulty), 
        malusLevel: parseInt(malusLevel),
        deadline: deadline || null,
        streak: 0, completed: false, createdAt: Date.now()
    };
    await db.ref(`users/${userId}/tasks`).push(newTask);
    res.json({ success: true });
});

// 5. Valider Tâche (Succès)
app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId } = req.body;
        const userRef = db.ref(`users/${userId}`);
        const taskRef = db.ref(`users/${userId}/tasks/${taskId}`);
        
        const userSnap = await userRef.once('value');
        const taskSnap = await taskRef.once('value');
        
        let user = userSnap.val();
        let task = taskSnap.val();

        if(!task) return res.json({success:false, message:"Tâche introuvable"});

        const rules = REWARDS[task.difficulty] || REWARDS[1];
        let gainCoin = getRandomCoin(rules.min, rules.max);
        let gainXp = rules.xp;

        // Bonus Série (Journalière)
        if (task.type === 'journaliere') {
            task.streak = (task.streak || 0) + 1;
            let multi = 1 + (Math.min(task.streak, 20) * 0.1); 
            gainCoin *= multi;
            gainXp *= multi;
        }

        // Drop Rubis
        let dropRuby = false;
        if (Math.random() < (task.difficulty * 0.05)) {
            user.stats.rubies = (user.stats.rubies || 0) + 1;
            dropRuby = true;
        }

        user.stats.coins = parseFloat((user.stats.coins + gainCoin).toFixed(2));
        user.stats.xp += Math.round(gainXp);

        // Level Up
        if (user.stats.xp >= (user.stats.level * XP_TO_LEVEL_UP)) {
            user.stats.level++;
            user.stats.xp = 0;
            user.stats.hp = Math.min(user.stats.hp + 20, user.stats.maxHp);
        }

        await taskRef.remove(); // Suppression
        await userRef.update({ stats: user.stats });

        res.json({ success: true, coins: gainCoin, xp: gainXp, ruby: dropRuby });
    } catch(e) {
        console.error(e);
        res.json({success:false, message: "Erreur validation"});
    }
});

// 6. Échec Tâche (C'est ici que tu avais le problème)
app.post('/api/fail-task', async (req, res) => {
    try {
        const { userId, taskId } = req.body;
        
        const userRef = db.ref(`users/${userId}`);
        const taskRef = db.ref(`users/${userId}/tasks/${taskId}`);
        
        const userSnap = await userRef.once('value');
        const taskSnap = await taskRef.once('value');
        
        let user = userSnap.val();
        let task = taskSnap.val();

        if (!task) {
            return res.json({ success: false, message: "Tâche introuvable (déjà supprimée ?)" });
        }

        // Calcul sécurisé des dégâts
        const nivMalus = task.malusLevel ? parseInt(task.malusLevel) : 1;
        const damage = MALUS[nivMalus] || 1;

        console.log(`💀 Échec manuel par ${user.pseudo}. Dégâts: ${damage}`);

        user.stats.hp -= damage;
        let message = `Tu as perdu ${damage} PV.`;

        // Mort
        if (user.stats.hp <= 0) {
            user.stats.hp = 100;
            user.stats.coins = 0;
            user.stats.level = Math.max(1, user.stats.level - 5);
            message = "☠️ MORT ! Tu as perdu tout ton or et 5 niveaux.";
        }

        // Sauvegarde
        await userRef.update({ stats: user.stats });
        // Suppression immédiate de la tâche
        await taskRef.remove();

        res.json({ success: true, message });

    } catch(e) {
        console.error("Erreur Fail Task:", e);
        res.json({ success: false, message: "Erreur serveur lors de l'échec." });
    }
});

// 7. Boutique (Ajout Item)
app.post('/api/create-shop-item', async (req, res) => {
    const { userId, name, price } = req.body;
    await db.ref(`users/${userId}/shop`).push({ name, price: parseFloat(price) });
    res.json({ success: true, message: "Ajouté !" });
});

// 8. Boutique (Achat)
app.post('/api/buy', async (req, res) => {
    const { userId, itemId, price, isPotion, itemName } = req.body;
    const userRef = db.ref(`users/${userId}`);
    let user = (await userRef.once('value')).val();

    let finalPrice = isPotion ? 150 : parseFloat(price);

    if (user.stats.coins >= finalPrice) {
        user.stats.coins = parseFloat((user.stats.coins - finalPrice).toFixed(2));
        
        if (isPotion) {
            user.stats.hp = Math.min(user.stats.maxHp, user.stats.hp + 50); 
        }
        
        await userRef.update({ stats: user.stats });
        res.json({ success: true, message: `Achat effectué ! (-${finalPrice})` });
    } else {
        res.json({ success: false, message: "Pas assez d'argent !" });
    }
});

// --- CRON JOB (Vérification automatique dates) ---
setInterval(async () => {
    try {
        const usersRef = db.ref('users');
        const snapshot = await usersRef.once('value');
        const users = snapshot.val();
        if (!users) return;

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        for (const [userId, user] of Object.entries(users)) {
            if (!user.tasks) continue;
            let userUpdated = false;

            for (const [taskId, task] of Object.entries(user.tasks)) {
                if (task.deadline) {
                    const deadlineDate = new Date(task.deadline);
                    if (deadlineDate < now) {
                        console.log(`⏰ Expiration tâche: ${task.name}`);
                        
                        const niv = task.malusLevel ? parseInt(task.malusLevel) : 1;
                        const dmg = MALUS[niv] || 1;
                        
                        user.stats.hp -= dmg;
                        if (user.stats.hp <= 0) {
                            user.stats.hp = 100;
                            user.stats.coins = 0;
                            user.stats.level = Math.max(1, user.stats.level - 5);
                        }
                        
                        userUpdated = true;
                        // Suppression DB
                        await db.ref(`users/${userId}/tasks/${taskId}`).remove();
                    }
                }
            }
            if (userUpdated) await db.ref(`users/${userId}/stats`).set(user.stats);
        }
    } catch(e) {
        console.error("Erreur Cron Job:", e);
    }
}, 60 * 1000); 

// Démarrage
app.listen(3000, () => {
    console.log('-------------------------------------------');
    console.log('✅ Real Quest Server est EN LIGNE !');
    console.log('💻 http://localhost:3000');
    console.log('-------------------------------------------');
});