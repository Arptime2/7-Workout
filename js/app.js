const SERVER_URL = 'http://localhost:5566';
const PROJECT_NAME = '7workout';

let exercises = [];
let warmups = [];
let currentWorkout = null;
let timer = null;
let timeLeft = 0;
let phase = 'warmup';
let exerciseIndex = 0;
let isPaused = false;
let currentDifficulty = 5;
let currentImageIndex = 0;

const store = {
    get: (key, def) => JSON.parse(localStorage.getItem(key) || JSON.stringify(def)),
    set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
};

let state = {
    settings: store.get('settings', { difficulty: 5 }),
    filters: { primaryMuscles: [], secondaryMuscles: [], force: [], equipment: [], mechanic: [], category: [], quiet: [], partner: [] },
    exerciseFeedback: store.get('exerciseFeedback', {})
};

try {
    const saved = JSON.parse(localStorage.getItem('filters'));
    if (saved) {
        state.filters.primaryMuscles = saved.primaryMuscles || [];
        state.filters.secondaryMuscles = saved.secondaryMuscles || [];
        state.filters.force = saved.force || [];
        state.filters.equipment = saved.equipment || [];
        state.filters.mechanic = saved.mechanic || [];
        state.filters.category = saved.category || [];
        state.filters.quiet = saved.quiet || [];
        state.filters.partner = saved.partner || [];
    }
} catch (e) {}

const loadExercises = async () => {
    try {
        const response = await fetch('data2/exercises/index.json');
        const dirs = await response.json();
        
        const exercisePromises = dirs.map(async (dir) => {
            try {
                const exResponse = await fetch(`data2/exercises/${dir.name}/exercise.json`);
                if (!exResponse.ok) return null;
                const exercise = await exResponse.json();
                return {
                    name: exercise.name,
                    difficulty: exercise.difficulty || 5,
                    description: exercise.instructions ? exercise.instructions.join(' ') : '',
                    bodyParts: [...(exercise.primaryMuscles || []), ...(exercise.secondaryMuscles || [])],
                    primaryMuscles: exercise.primaryMuscles || [],
                    secondaryMuscles: exercise.secondaryMuscles || [],
                    partner: exercise.partner === true,
                    force: exercise.force || 'push',
                    equipment: exercise.equipment || 'body only',
                    mechanic: exercise.mechanic || 'compound',
                    category: exercise.category || 'strength',
                    quiet: exercise.quiet !== false,
                    warmup: exercise.warmup === true,
                    id: dir.name,
                    type: exercise.warmup === true ? 'warmup' : 'exercise'
                };
            } catch (e) {
                return null;
            }
        });
        
        const loaded = await Promise.all(exercisePromises);
        const allLoaded = loaded.filter(e => e !== null);
        
        warmups = allLoaded.filter(e => e.type === 'warmup');
        exercises = allLoaded.filter(e => e.type === 'exercise');
        
        console.log(`Loaded: ${allLoaded.length} total, ${warmups.length} warmups, ${exercises.length} exercises`);
        
    } catch (e) {
        console.error('Error loading exercises:', e);
        warmups = [];
        exercises = [];
    }
};

const getFilterOptions = () => {
    const primaryMusclesSet = new Set();
    const secondaryMusclesSet = new Set();
    const forceSet = new Set();
    const equipmentSet = new Set();
    const mechanicSet = new Set();
    const categorySet = new Set();
    
    (exercises || []).forEach(e => {
        (e.primaryMuscles || []).forEach(p => primaryMusclesSet.add(p));
        (e.secondaryMuscles || []). forEach(p => secondaryMusclesSet.add(p));
        if (e.force) forceSet.add(e.force);
        if (e.equipment) equipmentSet.add(e.equipment);
        if (e.mechanic) mechanicSet.add(e.mechanic);
        if (e.category) categorySet.add(e.category);
    });
    
    return {
        primaryMuscles: Array.from(primaryMusclesSet).sort(),
        secondaryMuscles: Array.from(secondaryMusclesSet).sort(),
        force: Array.from(forceSet).sort(),
        equipment: Array.from(equipmentSet).sort(),
        mechanic: Array.from(mechanicSet).sort(),
        category: Array.from(categorySet).sort()
    };
};

const countAvailableExercises = () => {
    if (!exercises || exercises.length === 0) {
        return 0;
    }
    
    let count = 0;
    exercises.forEach(e => {
        if (e.warmup) return;
        
        let matches = true;
        
        if (state.filters.primaryMuscles.length > 0) {
            const hasMatch = (e.primaryMuscles || []).some(p => state.filters.primaryMuscles.includes(p));
            if (!hasMatch) matches = false;
        }
        
        if (state.filters.secondaryMuscles.length > 0) {
            const hasMatch = (e.secondaryMuscles || []).some(p => state.filters.secondaryMuscles.includes(p));
            if (!hasMatch && (e.primaryMuscles || []).length === 0) matches = false;
        }
        
        if (state.filters.force.length > 0) {
            if (!e.force || !state.filters.force.includes(e.force)) matches = false;
        }
        
        if (state.filters.equipment.length > 0) {
            if (!e.equipment || !state.filters.equipment.includes(e.equipment)) matches = false;
        }
        
        if (state.filters.mechanic.length > 0) {
            if (!e.mechanic || !state.filters.mechanic.includes(e.mechanic)) matches = false;
        }
        
        if (state.filters.category.length > 0) {
            if (!e.category || !state.filters.category.includes(e.category)) matches = false;
        }
        
        if (state.filters.quiet.length === 1) {
            const wantsQuiet = state.filters.quiet.includes('true');
            const wantsLoud = state.filters.quiet.includes('false');
            if (wantsQuiet && !e.quiet) matches = false;
            if (wantsLoud && e.quiet) matches = false;
        }
        
        if (state.filters.partner.includes('exclude') && e.partner) matches = false;
        
        if (matches) count++;
    });
    
    return count;
};

const getEffectiveDifficulty = (exercise) => {
    if (exercise.id && state.exerciseFeedback[exercise.id]) {
        return Math.round(state.exerciseFeedback[exercise.id].avgScore);
    }
    return exercise.difficulty || 5;
};

const normalPDF = (x, mean, stdDev) => {
    const exp = -0.5 * Math.pow((x - mean) / stdDev, 2);
    return Math.exp(exp);
};

const selectExercises = (targetDiff, count, filters) => {
    let pool = (exercises || []).filter(e => !e.partner && !e.warmup);
    
    if (filters.primaryMuscles.length > 0) {
        pool = pool.filter(e => (e.primaryMuscles || []).some(p => filters.primaryMuscles.includes(p)));
    }
    
    if (filters.secondaryMuscles.length > 0) {
        pool = pool.filter(e => (e.secondaryMuscles || []).length === 0 || (e.secondaryMuscles || []).some(p => filters.secondaryMuscles.includes(p)));
    }
    
    if (filters.force.length > 0) {
        pool = pool.filter(e => e.force && filters.force.includes(e.force));
    }
    
    if (filters.equipment.length > 0) {
        pool = pool.filter(e => e.equipment && filters.equipment.includes(e.equipment));
    }
    
    if (filters.mechanic.length > 0) {
        pool = pool.filter(e => e.mechanic && filters.mechanic.includes(e.mechanic));
    }
    
    if (filters.category.length > 0) {
        pool = pool.filter(e => e.category && filters.category.includes(e.category));
    }
    
    if (filters.quiet.length === 1) {
        const wantsQuiet = filters.quiet.includes('true');
        const wantsLoud = filters.quiet.includes('false');
        pool = pool.filter(e => {
            if (wantsQuiet) return e.quiet;
            if (wantsLoud) return !e.quiet;
            return true;
        });
    }
    
    if (filters.partner.includes('exclude')) {
        pool = pool.filter(e => !e.partner);
    }
    
    const stdDev = 1.5;
    
    const difficulties = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const rawProbs = difficulties.map(d => normalPDF(d, targetDiff, stdDev));
    const sumProbs = rawProbs.reduce((a, b) => a + b, 0);
    const probabilities = rawProbs.map(p => p / sumProbs);
    
    const selectedDifficulties = [];
    for (let i = 0; i < count; i++) {
        const rand = Math.random();
        let cumulative = 0;
        for (let d = 0; d < 10; d++) {
            cumulative += probabilities[d];
            if (rand <= cumulative) {
                selectedDifficulties.push(d + 1);
                break;
            }
        }
    }
    
    const byDifficulty = {};
    difficulties.forEach(d => byDifficulty[d] = []);
    pool.forEach(e => {
        const effDiff = getEffectiveDifficulty(e);
        if (!byDifficulty[effDiff]) byDifficulty[effDiff] = [];
        byDifficulty[effDiff].push(e);
    });
    
    const selected = [];
    const usedIds = new Set();
    
    for (const diff of selectedDifficulties) {
        const candidates = byDifficulty[diff] || [];
        const available = candidates.filter(e => !usedIds.has(e.id));
        
        if (available.length > 0) {
            const choice = available[Math.floor(Math.random() * available.length)];
            selected.push(choice);
            usedIds.add(choice.id);
        }
    }
    
    if (selected.length < count) {
        const remaining = pool.filter(e => !usedIds.has(e.id));
        while (selected.length < count && remaining.length > 0) {
            const idx = Math.floor(Math.random() * remaining.length);
            selected.push(remaining[idx]);
            remaining.splice(idx, 1);
        }
    }
    
    return selected;
};

const generateWorkout = () => {
    const diff = state.settings.difficulty;
    
    const selectedWarmups = warmups
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);
    
    const mainCount = 12;
    const mainExercises = selectExercises(diff, mainCount, state.filters);
    
    return {
        warmups: selectedWarmups,
        main: mainExercises,
        targetDifficulty: diff
    };
};

const speak = (text) => {
    if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(u);
    }
};

const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const app = {
    currentView: 'home',
    
    navigate: (view) => {
        app.currentView = view;
        const container = document.getElementById('app');
        container.innerHTML = '';
        
        if (view === 'home') app.renderHome(container);
        else if (view === 'workout') app.renderWorkout(container);
        else if (view === 'settings') app.renderSettings(container);
    },
    
    renderHome: (container) => {
        const opts = getFilterOptions();
        const selectedPrimary = (state.filters && state.filters.primaryMuscles) || [];
        const selectedSecondary = (state.filters && state.filters.secondaryMuscles) || [];
        const selectedForce = (state.filters && state.filters.force) || [];
        const selectedEquipment = (state.filters && state.filters.equipment) || [];
        const selectedMechanic = (state.filters && state.filters.mechanic) || [];
        const selectedCategory = (state.filters && state.filters.category) || [];
        const selectedQuiet = (state.filters && state.filters.quiet) || [];
        const availableCount = countAvailableExercises();
        
        container.innerHTML = `
            <div class="scroll-container">
                <h1 class="text-2xl mb-2">7-Min Workout</h1>
                <p class="text-muted mb-4">Quick fitness session</p>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Difficulty Level</div>
                    <div class="difficulty-display">${state.settings.difficulty}/10</div>
                    <input type="range" min="1" max="10" value="${state.settings.difficulty}" 
                        onchange="app.setDifficulty(this.value)">
                    <div class="flex justify-between text-xs text-muted mt-1">
                        <span>Easy</span>
                        <span>Hard</span>
                    </div>
                </div>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Primary Muscles</div>
                    <div class="filter-grid">
                        ${opts.primaryMuscles.map(m => `
                            <label class="filter-chip ${selectedPrimary.includes(m) ? 'selected' : ''}" data-filter="primaryMuscles" data-value="${m}">
                                <input type="checkbox" ${selectedPrimary.includes(m) ? 'checked' : ''}
                                    onchange="app.toggleFilter('primaryMuscles', '${m}', this.checked)">
                                ${m}
                            </label>
                        `).join('')}
                    </div>
                </div>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Secondary Muscles</div>
                    <div class="filter-grid">
                        ${opts.secondaryMuscles.map(m => `
                            <label class="filter-chip ${selectedSecondary.includes(m) ? 'selected' : ''}" data-filter="secondaryMuscles" data-value="${m}">
                                <input type="checkbox" ${selectedSecondary.includes(m) ? 'checked' : ''}
                                    onchange="app.toggleFilter('secondaryMuscles', '${m}', this.checked)">
                                ${m}
                            </label>
                        `).join('')}
                    </div>
                </div>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Force</div>
                    <div class="filter-grid">
                        ${opts.force.map(f => `
                            <label class="filter-chip ${selectedForce.includes(f) ? 'selected' : ''}" data-filter="force" data-value="${f}">
                                <input type="checkbox" ${selectedForce.includes(f) ? 'checked' : ''}
                                    onchange="app.toggleFilter('force', '${f}', this.checked)">
                                ${f}
                            </label>
                        `).join('')}
                    </div>
                </div>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Equipment</div>
                    <div class="filter-grid">
                        ${opts.equipment.map(e => `
                            <label class="filter-chip ${selectedEquipment.includes(e) ? 'selected' : ''}" data-filter="equipment" data-value="${e}">
                                <input type="checkbox" ${selectedEquipment.includes(e) ? 'checked' : ''}
                                    onchange="app.toggleFilter('equipment', '${e}', this.checked)">
                                ${e}
                            </label>
                        `).join('')}
                    </div>
                </div>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Mechanic</div>
                    <div class="filter-grid">
                        ${opts.mechanic.map(m => `
                            <label class="filter-chip ${selectedMechanic.includes(m) ? 'selected' : ''}" data-filter="mechanic" data-value="${m}">
                                <input type="checkbox" ${selectedMechanic.includes(m) ? 'checked' : ''}
                                    onchange="app.toggleFilter('mechanic', '${m}', this.checked)">
                                ${m}
                            </label>
                        `).join('')}
                    </div>
                </div>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Category</div>
                    <div class="filter-grid">
                        ${opts.category.map(c => `
                            <label class="filter-chip ${selectedCategory.includes(c) ? 'selected' : ''}" data-filter="category" data-value="${c}">
                                <input type="checkbox" ${selectedCategory.includes(c) ? 'checked' : ''}
                                    onchange="app.toggleFilter('category', '${c}', this.checked)">
                                ${c}
                            </label>
                        `).join('')}
                    </div>
                </div>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Noise Level</div>
                    <div class="filter-grid">
                        <label class="filter-chip ${selectedQuiet.includes('true') ? 'selected' : ''}" data-filter="quiet" data-value="true">
                            <input type="checkbox" ${selectedQuiet.includes('true') ? 'checked' : ''}
                                onchange="app.toggleFilter('quiet', 'true', this.checked)">
                            Quiet
                        </label>
                        <label class="filter-chip ${selectedQuiet.includes('false') ? 'selected' : ''}" data-filter="quiet" data-value="false">
                            <input type="checkbox" ${selectedQuiet.includes('false') ? 'checked' : ''}
                                onchange="app.toggleFilter('quiet', 'false', this.checked)">
                            Loud
                        </label>
                    </div>
                </div>
                
                <div class="card">
                    <div class="text-sm text-muted mb-2">Partner Required</div>
                    <div class="filter-grid">
                        <label class="filter-chip" data-filter="partner" data-value="exclude">
                            <input type="checkbox" ${state.filters.partner.includes('exclude') ? 'checked' : ''}
                                onchange="app.toggleFilter('partner', 'exclude', this.checked)">
                            Exclude Partner Exercises
                        </label>
                    </div>
                </div>
                
                <div class="card" style="text-align: center;">
                    <div class="text-sm text-muted">Available Exercises</div>
                    <div class="difficulty-display" id="exerciseCount">${availableCount}</div>
                </div>
                
                <button class="btn btn-danger mt-2" onclick="app.clearFilters()">Clear All Filters</button>
                
                <button class="btn btn-primary btn-lg mt-2" onclick="app.startWorkout()">
                    Start 7-Min Workout
                </button>
                
                <button class="btn btn-lg mt-2" style="background: var(--card); border-color: var(--card-border);" onclick="app.navigate('settings')">
                    Settings & Sync
                </button>
            </div>
        `;
    },
    
    setDifficulty: (val) => {
        state.settings.difficulty = parseInt(val);
        store.set('settings', state.settings);
        document.querySelector('.difficulty-display').textContent = val + '/10';
    },
    
    toggleFilter: (filterType, value, checked) => {
        if (!state.filters[filterType]) {
            state.filters[filterType] = [];
        }
        if (checked) {
            state.filters[filterType].push(value);
        } else {
            state.filters[filterType] = state.filters[filterType].filter(v => v !== value);
        }
        store.set('filters', state.filters);
        
        const chip = document.querySelector(`label[data-filter="${filterType}"][data-value="${value}"]`);
        if (chip) {
            chip.classList.toggle('selected', checked);
        }
        
        console.log('Filter updated:', filterType, value, checked, 'filters:', state.filters);
        
        const countEl = document.getElementById('exerciseCount');
        if (countEl) {
            const newCount = countAvailableExercises();
            console.log('New count:', newCount);
            countEl.textContent = newCount;
        }
    },
    
    clearFilters: () => {
        localStorage.removeItem('filters');
        state.filters = { primaryMuscles: [], secondaryMuscles: [], force: [], equipment: [], mechanic: [], category: [], quiet: [], partner: [] };
        app.navigate('home');
    },
    
    startWorkout: () => {
        currentWorkout = generateWorkout();
        phase = 'warmup';
        exerciseIndex = 0;
        currentDifficulty = state.settings.difficulty;
        currentImageIndex = 0;
        app.navigate('workout');
    },
    
    getExerciseImages: (exercise) => {
        const dirName = exercise.id || exercise.name.replace(/\s+/g, '_').toLowerCase();
        return [
            `data2/exercises/${dirName}/images/0.jpg`,
            `data2/exercises/${dirName}/images/1.jpg`
        ];
    },
    
    renderWorkout: (container) => {
        const wo = currentWorkout;
        const isWarmup = phase === 'warmup';
        const isRest = phase === 'rest';
        const currentEx = isWarmup ? wo.warmups[exerciseIndex] : wo.main[exerciseIndex];
        
        const warmupCount = wo.warmups.length;
        const mainCount = wo.main.length;
        
        const images = app.getExerciseImages(currentEx);
        const imageIndex = currentImageIndex || 0;
        
        let contentHTML = '';
        
        if (!isRest) {
            contentHTML = `
                <div class="exercise-images">
                    <img src="${images[imageIndex]}" alt="${currentEx.name}" 
                        class="exercise-image" 
                        onclick="app.nextImage()"
                        onerror="this.style.display='none'">
                    <div class="image-dots">
                        ${images.map((_, i) => `<span class="dot ${i === imageIndex ? 'active' : ''}" onclick="app.switchImage(${i})"></span>`).join('')}
                    </div>
                </div>
                <h2 class="exercise-name">${currentEx.name}</h2>
                <div class="exercise-diff">Difficulty: ${getEffectiveDifficulty(currentEx)}/10</div>
                <p class="exercise-desc">${currentEx.description}</p>
            `;
        } else {
            contentHTML = `
                <h2 class="exercise-name">Rest</h2>
                <p class="exercise-desc">Rate this exercise</p>
                
                <div class="rest-rating">
                    <div class="text-sm text-muted mb-2">How was "${currentEx.name}"?</div>
                    <div class="difficulty-display" id="restRatingDisplay">5</div>
                    <input type="range" min="1" max="10" value="5" id="restRatingSlider"
                        onchange="document.getElementById('restRatingDisplay').textContent = this.value">
                    <div class="flex justify-between text-xs text-muted mt-1">
                        <span>Too Easy</span>
                        <span>Perfect</span>
                        <span>Too Hard</span>
                    </div>
                </div>
                
                <button class="btn mt-2" style="width: 100%; max-width: 280px;" onclick="app.submitRating()">
                    Submit
                </button>
            `;
        }
        
        container.innerHTML = `
            <div class="workout-screen">
                <div class="workout-header">
                    <button class="btn btn-sm" onclick="app.quitWorkout()">Quit</button>
                    <div class="workout-info">
                        <div class="phase-label">${isRest ? 'REST' : phase.toUpperCase()}</div>
                        <div class="progress-label">
                            ${isWarmup ? `${exerciseIndex + 1}/${warmupCount}` : `${exerciseIndex + 1}/${mainCount}`}
                        </div>
                    </div>
                </div>
                
                <div class="workout-content">
                    ${contentHTML}
                    
                    <div class="timer-circle ${isRest ? 'rest-timer' : ''}">
                        <div class="timer-ring" id="timerRing"></div>
                        <div class="timer-text" id="timerDisplay">${formatTime(timeLeft)}</div>
                    </div>
                </div>
                
                <div class="workout-controls">
                    <div class="button-row">
                        <button class="btn btn-lg" id="pauseBtn" onclick="app.togglePause()">
                            ${isPaused ? 'Resume' : 'Pause'}
                        </button>
                        <button class="btn btn-lg btn-primary" onclick="app.skipExercise()">
                            ${isRest ? 'Next' : 'Skip'}
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        if (isWarmup) {
            timeLeft = 20;
        } else if (isRest) {
            timeLeft = 15;
        } else {
            timeLeft = 30;
        }
        
        if (!isRest) {
            speak(currentEx.name);
        }
        updateTimerDisplay();
        startTimer();
    },
    
    nextImage: () => {
        const wo = currentWorkout;
        const isWarmup = phase === 'warmup';
        const currentEx = isWarmup ? wo.warmups[exerciseIndex] : wo.main[exerciseIndex];
        const images = app.getExerciseImages(currentEx);
        currentImageIndex = (currentImageIndex + 1) % images.length;
        app.renderWorkout(document.getElementById('app'));
    },
    
    switchImage: (index) => {
        currentImageIndex = index;
        app.renderWorkout(document.getElementById('app'));
    },
    
    togglePause: () => {
        isPaused = !isPaused;
        document.getElementById('pauseBtn').textContent = isPaused ? 'Resume' : 'Pause';
    },
    
    skipExercise: () => {
        nextPhase();
    },
    
    submitRating: () => {
        if (phase !== 'rest') return;
        
        const ratingSlider = document.getElementById('restRatingSlider');
        const rating = ratingSlider ? parseInt(ratingSlider.value) : 5;
        
        const wo = currentWorkout;
        const lastEx = wo.main[exerciseIndex];
        
        if (lastEx && lastEx.id) {
            if (!state.exerciseFeedback[lastEx.id]) {
                state.exerciseFeedback[lastEx.id] = { avgScore: 5, count: 0 };
            }
            const old = state.exerciseFeedback[lastEx.id];
            const newAvg = ((old.avgScore * old.count) + rating) / (old.count + 1);
            state.exerciseFeedback[lastEx.id] = { avgScore: newAvg, count: old.count + 1 };
            store.set('exerciseFeedback', state.exerciseFeedback);
        }
        
        const submitBtn = document.querySelector('.rest-rating + .btn');
        if (submitBtn) {
            submitBtn.textContent = 'Submitted!';
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
        }
    },
    
    quitWorkout: () => {
        if (confirm('Quit workout?')) {
            clearInterval(timer);
            app.navigate('home');
        }
    },
    
    renderSettings: (container) => {
        container.innerHTML = `
            <div class="scroll-container">
                <h1 class="text-2xl mb-4">Settings</h1>
                
                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">Cloud Sync</h3>
                    <p class="text-xs text-muted mb-3">Connect to your local Save-Server to backup and sync your data.</p>
                    <div class="flex gap-2">
                        <button class="btn btn-primary flex-1" onclick="app.saveToServer()">
                            Save to Server
                        </button>
                        <button class="btn flex-1" style="background: var(--accent); border-color: var(--accent); color: white;" onclick="app.syncFromServer()">
                            Sync from Server
                        </button>
                    </div>
                    <p id="syncStatus" class="text-xs text-muted mt-2 text-center"></p>
                </div>
            </div>
        `;
    },
    
    saveToServer: async () => {
        const statusEl = document.getElementById('syncStatus');
        statusEl.innerText = 'Saving...';
        statusEl.style.color = 'var(--primary)';
        
        try {
            const data = {
                settings: state.settings,
                filters: state.filters,
                lastSync: new Date().toISOString()
            };
            
            await saveData(PROJECT_NAME, 'appData', data);
            statusEl.innerText = 'Saved successfully!';
            statusEl.style.color = 'var(--accent)';
        } catch (error) {
            statusEl.innerText = 'Error: ' + error.message;
            statusEl.style.color = 'var(--danger)';
        }
    },
    
    syncFromServer: async () => {
        const statusEl = document.getElementById('syncStatus');
        statusEl.innerText = 'Syncing...';
        statusEl.style.color = 'var(--primary)';
        
        try {
            const data = await getData(PROJECT_NAME);
            const d = data.files && data.files[0] ? data.files[0] : null;
            
            if (!d) {
                statusEl.innerText = 'No saved data found on server';
                statusEl.style.color = 'var(--danger)';
                return;
            }
            
            if (d.settings) state.settings = d.settings;
            if (d.filters) state.filters = d.filters;
            
            store.set('settings', state.settings);
            store.set('filters', state.filters);
            
            statusEl.innerText = 'Synced!';
            statusEl.style.color = 'var(--accent)';
        } catch (error) {
            statusEl.innerText = 'Error: ' + error.message;
            statusEl.style.color = 'var(--danger)';
        }
    }
};

const startTimer = () => {
    clearInterval(timer);
    timer = setInterval(() => {
        if (isPaused) return;
        
        timeLeft--;
        updateTimerDisplay();
        
        if (timeLeft <= 0) {
            nextPhase();
        }
    }, 1000);
};

const updateTimerDisplay = () => {
    const display = document.getElementById('timerDisplay');
    const ring = document.getElementById('timerRing');
    
    if (display) display.textContent = formatTime(timeLeft);
    
    if (ring) {
        const totalTime = phase === 'warmup' ? 20 : (phase === 'rest' ? 15 : 30);
        const progress = Math.max(0, timeLeft / totalTime);
        const rotation = progress * 360;
        ring.style.transform = `rotate(${rotation}deg)`;
    }
};

const nextPhase = () => {
    const wo = currentWorkout;
    
    if (phase === 'warmup') {
        exerciseIndex++;
        if (exerciseIndex >= wo.warmups.length) {
            phase = 'work';
            exerciseIndex = 0;
            currentImageIndex = 0;
            if (wo.main.length > 0) {
                currentDifficulty = state.settings.difficulty;
                speak(wo.main[0].name);
                app.renderWorkout(document.getElementById('app'));
                return;
            }
        } else {
            speak(wo.warmups[exerciseIndex].name);
            app.renderWorkout(document.getElementById('app'));
            return;
        }
    }
    
    if (phase === 'work') {
        phase = 'rest';
        app.renderWorkout(document.getElementById('app'));
        speak("Rest");
        return;
    }
    
    if (phase === 'rest') {
        exerciseIndex++;
        currentImageIndex = 0;
        if (exerciseIndex >= wo.main.length) {
            finishWorkout();
            return;
        }
        phase = 'work';
        speak(wo.main[exerciseIndex].name);
        app.renderWorkout(document.getElementById('app'));
        return;
    }
};

const finishWorkout = () => {
    clearInterval(timer);
    const container = document.getElementById('app');
    container.innerHTML = `
        <div class="scroll-container flex flex-col h-full justify-center text-center">
            <h1 class="text-2xl mb-4 text-accent">Workout Complete!</h1>
            <p class="text-muted">Great job finishing your 7-minute workout.</p>
            <button class="btn btn-primary btn-lg mt-6" onclick="app.navigate('home')">
                Back to Home
            </button>
        </div>
    `;
};

loadExercises().then(() => {
    app.navigate('home');
});
