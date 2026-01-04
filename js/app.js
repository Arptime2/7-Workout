let allExercises = [];
let warmupExercises = [];

const exerciseLoader = {
    loadAll: async () => {
        try {
            const response = await fetch('data2/exercises/index.json');
            if (!response.ok) throw new Error('Failed to load exercises index');
            const dirs = await response.json();
            
            const exercisePromises = dirs.map(async (dir) => {
                try {
                    const exResponse = await fetch(`data2/exercises/${dir.name}/exercise.json`);
                    if (!exResponse.ok) return null;
                    const exercise = await exResponse.json();
                    exercise.id = dir.name;
                    return exercise;
                } catch (e) {
                    return null;
                }
            });
            
            const loaded = await Promise.all(exercisePromises);
            allExercises = loaded.filter(e => e !== null);
            
            warmupExercises = allExercises.filter(e => e.warmup === true);
            
        } catch (error) {
            console.error('Error loading exercises:', error);
            allExercises = [];
            warmupExercises = [
                { name: "Neck Circles", desc: "Rotate your neck in large circles.", difficulty: 1, id: "neck-circles", warmup: true, met: 2, quiet: true, category: 'stretching', primaryMuscles: ['neck'] },
                { name: "Arm Circles", desc: "Swing arms in circles.", difficulty: 1, id: "arm-circles", warmup: true, met: 2, quiet: true, category: 'stretching', primaryMuscles: ['shoulders'] },
                { name: "Shoulder Shrugs", desc: "Lift and drop shoulders.", difficulty: 1, id: "shoulder-shrugs", warmup: true, met: 2, quiet: true, category: 'stretching', primaryMuscles: ['traps'] },
                { name: "Torso Twists", desc: "Twist side to side.", difficulty: 1, id: "torso-twists", warmup: true, met: 2, quiet: true, category: 'stretching', primaryMuscles: ['obliques'] },
                { name: "Wrist Rotations", desc: "Rotate wrists.", difficulty: 1, id: "wrist-rotations", warmup: true, met: 1, quiet: true, category: 'stretching', primaryMuscles: ['forearms'] }
            ];
        }
    }
};

const store = {
    get: (key, def) => JSON.parse(localStorage.getItem(key) || JSON.stringify(def)),
    set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
};

let state = {
    workouts: store.get('workouts', []),
    settings: store.get('settings', { weight: 70, difficultyBias: 0 }),
    exerciseFeedback: store.get('ex_feedback', {}),
    customExercises: store.get('custom_exercises', []),
    filters: store.get('filters', null)
};

if (!state.filters) {
    state.filters = {
        force: [],
        mechanic: [],
        equipment: [],
        primaryMuscles: [],
        secondaryMuscles: [],
        category: [],
        quiet: []
    };
} else {
    if (!state.filters.force) state.filters.force = [];
    if (!state.filters.mechanic) state.filters.mechanic = [];
    if (!state.filters.equipment) state.filters.equipment = [];
    if (!state.filters.primaryMuscles) state.filters.primaryMuscles = [];
    if (!state.filters.secondaryMuscles) state.filters.secondaryMuscles = [];
    if (!state.filters.category) state.filters.category = [];
    if (!state.filters.quiet) state.filters.quiet = [];
}

class Chart {
    static draw(canvasId, dataPoints, color) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.parentElement.offsetWidth;
        const h = canvas.height = 200;
        
        ctx.clearRect(0,0,w,h);
        
        if(dataPoints.length < 2) {
            ctx.fillStyle = "#6b7280";
            ctx.font = "14px sans-serif";
            ctx.fillText("Complete more workouts", w/2 - 70, h/2);
            return;
        }

        const max = Math.max(...dataPoints);
        const min = Math.min(...dataPoints) * 0.9;
        const range = max - min || 1;
        const stepX = w / (dataPoints.length - 1);

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        dataPoints.forEach((val, i) => {
            const x = i * stepX;
            const y = h - ((val - min) / range) * (h - 40) - 20;
            if(i===0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.fillStyle = color + "20"; 
        ctx.fill();

        ctx.fillStyle = "#fff";
        dataPoints.forEach((val, i) => {
            const x = i * stepX;
            const y = h - ((val - min) / range) * (h - 40) - 20;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
    }
}

const Logic = {
    analyzeUser: () => {
        const recent = state.workouts.slice(-5);
        if(recent.length === 0) return 0;
        
        const avgRpe = recent.reduce((acc, w) => acc + w.rpe, 0) / recent.length;
        let bias = state.settings.difficultyBias;

        if (avgRpe > 8) bias -= 0.5; 
        else if (avgRpe < 5) bias += 0.5; 
        else bias += 0.1;

        return Math.max(-1.5, Math.min(2.5, bias));
    },

    getEffectiveDifficulty: (exercise) => {
        let baseDiff = exercise.difficulty || 5;
        const fb = state.exerciseFeedback[exercise.id];
        if (fb) {
            if (fb.avgScore >= 8) baseDiff += 1;
            if (fb.avgScore <= 3) baseDiff -= 1;
        }
        return Math.max(0, Math.min(10, baseDiff));
    },

    matchesFilters: (exercise) => {
        const f = state.filters;
        
        if (f.force.length > 0 && exercise.force && !f.force.includes(exercise.force)) return false;
        if (f.mechanic.length > 0 && exercise.mechanic && !f.mechanic.includes(exercise.mechanic)) return false;
        if (f.equipment.length > 0 && exercise.equipment && !f.equipment.includes(exercise.equipment)) return false;
        if (f.category.length > 0 && exercise.category && !f.category.includes(exercise.category)) return false;
        if (f.quiet.length > 0) {
            const wantsQuiet = f.quiet.includes('true');
            const wantsLoud = f.quiet.includes('false');
            if (wantsQuiet && !exercise.quiet) return false;
            if (wantsLoud && exercise.quiet) return false;
        }
        
        const opts = router.filterOptions || {};
        const allPrimarySelected = f.primaryMuscles.length > 0 && 
            opts.primaryMuscles && 
            f.primaryMuscles.length === opts.primaryMuscles.length;
        const allSecondarySelected = f.secondaryMuscles.length > 0 && 
            opts.secondaryMuscles && 
            f.secondaryMuscles.length === opts.secondaryMuscles.length;
        
        if (f.primaryMuscles.length === 0) {
            // No primary filter - matches everything
        } else if (allPrimarySelected) {
            // All primary muscles selected - include exercises with or without muscle data
        } else if (!exercise.primaryMuscles || exercise.primaryMuscles.length === 0) {
            // Filter is active but exercise has no muscles - doesn't match
            return false;
        } else if (!exercise.primaryMuscles.some(m => f.primaryMuscles.includes(m))) {
            // Exercise muscles don't match selected filters
            return false;
        }
        
        if (f.secondaryMuscles.length === 0) {
            // No secondary filter - matches everything
        } else if (allSecondarySelected) {
            // All secondary muscles selected - include exercises with or without muscle data
        } else if (!exercise.secondaryMuscles || exercise.secondaryMuscles.length === 0) {
            // Filter is active but exercise has no secondary muscles - doesn't match
            return false;
        } else if (!exercise.secondaryMuscles.some(m => f.secondaryMuscles.includes(m))) {
            // Exercise secondary muscles don't match selected filters
            return false;
        }
        
        return true;
    },

    generateWorkout: () => {
        const bias = Logic.analyzeUser();
        state.settings.difficultyBias = bias;
        store.set('settings', state.settings);

        const selectedWarmups = [];
        const wuPool = warmupExercises.filter(e => Logic.matchesFilters(e));
        for(let i=0; i<3; i++) {
            if (wuPool.length === 0) break;
            const idx = Math.floor(Math.random() * wuPool.length);
            selectedWarmups.push({...wuPool.splice(idx, 1)[0], met: 4});
        }

        let targetDiff = Math.max(0, Math.min(10, 5 + bias * 2));

        let pool = allExercises.filter(e => !e.warmup && Logic.matchesFilters(e));
        
        pool = pool.filter(e => {
            const effDiff = Logic.getEffectiveDifficulty(e);
            return Math.abs(effDiff - targetDiff) <= 3;
        });

        let upperPool = pool.filter(e => 
            e.primaryMuscles && e.primaryMuscles.some(m => 
                ['chest', 'pectorals', 'back', 'lats', 'traps', 'middle back', 'lower back', 'shoulders', 'deltoids', 'biceps', 'triceps'].includes(m.toLowerCase())
            )
        );
        let lowerPool = pool.filter(e => 
            e.primaryMuscles && e.primaryMuscles.some(m => 
                ['quadriceps', 'quads', 'hamstrings', 'glutes', 'calves'].includes(m.toLowerCase())
            )
        );
        let corePool = pool.filter(e => 
            e.primaryMuscles && e.primaryMuscles.some(m => 
                ['abdominals', 'abs', 'obliques'].includes(m.toLowerCase())
            )
        );
        let cardioPool = pool.filter(e => 
            e.primaryMuscles && e.primaryMuscles.some(m => m.toLowerCase() === 'cardio')
        );

        const sortPool = (p) => p.sort((a,b) => {
            const distA = Math.abs(Logic.getEffectiveDifficulty(a) - targetDiff) + Math.random() * 0.5;
            const distB = Math.abs(Logic.getEffectiveDifficulty(b) - targetDiff) + Math.random() * 0.5;
            return distA - distB;
        });

        sortPool(upperPool);
        sortPool(lowerPool);
        sortPool(corePool);
        sortPool(cardioPool);

        let selectedExercises = [
            ...upperPool.slice(0,4),
            ...lowerPool.slice(0,4),
            ...corePool.slice(0,2),
            ...cardioPool.slice(0,2)
        ];

        if (selectedExercises.length < 12) {
            let remaining = pool.filter(e => !selectedExercises.includes(e));
            sortPool(remaining);
            selectedExercises.push(...remaining.slice(0, 12 - selectedExercises.length));
        }
        selectedExercises = selectedExercises.slice(0,12);

        for (let i = selectedExercises.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [selectedExercises[i], selectedExercises[j]] = [selectedExercises[j], selectedExercises[i]];
        }

        return {
            warmups: selectedWarmups,
            main: selectedExercises,
            totalTime: (selectedExercises.length * 40) + (selectedWarmups.length * 30),
            targetDifficulty: targetDiff
        };
    }
};

const getImages = (exercise) => {
    const exerciseDir = exercise.id || exercise.name.replace(/\s/g, '_').toLowerCase();
    return [
        `data2/exercises/${exerciseDir}/images/0.jpg`,
        `data2/exercises/${exerciseDir}/images/1.jpg`
    ];
};

const getMetForExercise = (exercise, isWarmup) => {
    if (isWarmup) return 3;
    if (exercise.met) return exercise.met;
    
    const diff = exercise.difficulty || 5;
    const quiet = exercise.quiet !== false;
    const category = (exercise.category || '').toLowerCase();
    
    let baseMet = 4;
    
    if (category === 'cardio') baseMet = 8;
    else if (category === 'plyometrics') baseMet = 9;
    else if (category === 'strength') {
        if (diff <= 3) baseMet = 4;
        else if (diff <= 6) baseMet = 6;
        else baseMet = 8;
    }
    else if (category === 'stretching') baseMet = 2;
    else if (category === 'powerlifting') baseMet = 7;
    
    if (!quiet) baseMet += 1;
    
    return Math.max(2, Math.min(10, baseMet));
};

const router = {
    current: 'home',
    activeWorkout: null,
    timer: null,
    tempScore: 5,
    filterOptions: null,

    navigate: (view) => {
        router.current = view;
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        
        const app = document.getElementById('app');
        app.innerHTML = '';

        if (view === 'home') router.renderHome(app);
        else if (view === 'workout') router.renderWorkout(app);
        else if (view === 'stats') router.renderStats(app);
        else if (view === 'algo') router.renderAlgo(app);
        else if (view === 'library') router.renderLibrary(app);
        else if (view === 'custom') router.renderCustom(app);
        else if (view === 'settings') router.renderSettings(app);
        else if (view === 'filter') router.renderFilter(app);
        
        const navMap = { 'home':0, 'library':1, 'stats':2, 'algo':3, 'custom':4, 'settings':5 };
        if(navMap[view] !== undefined) document.querySelectorAll('.nav-item')[navMap[view]].classList.add('active');
        
        document.getElementById('mainNav').style.display = (view === 'workout' || view === 'filter') ? 'none' : 'flex';
    },

    renderHome: (container) => {
        const workoutCount = state.workouts.length;
        const bias = state.settings.difficultyBias;

        container.innerHTML = `
            <div class="scroll-container">
                <h1 class="text-2xl mb-2">Hello, Athlete</h1>
                <p class="text-muted mb-4">Your daily fitness awaits.</p>

                <div class="card flex justify-between">
                    <div class="text-center">
                        <div class="text-xl text-primary">${workoutCount}</div>
                        <div class="text-sm text-muted">Workouts</div>
                    </div>
                    <div class="text-center">
                        <div class="text-xl text-accent">${state.workouts.reduce((a,b)=>a+b.calories, 0)}</div>
                        <div class="text-sm text-muted">Kcal Burned</div>
                    </div>
                    <div class="text-center">
                        <div class="text-xl">${Math.max(0, Math.min(10, Math.round(5 + bias * 2)))}/10</div>
                        <div class="text-sm text-muted">Difficulty Level</div>
                    </div>
                </div>

                <button class="btn btn-primary btn-lg" onclick="router.navigate('filter')">
                    Start 7-Min Workout
                </button>

                <h3 class="text-xl mt-4 mb-2">Recent Activity</h3>
                ${state.workouts.slice().reverse().slice(0,3).map(w => `
                    <div class="card flex justify-between items-center">
                        <div>
                            <div class="font-bold">${new Date(w.date).toLocaleDateString()}</div>
                            <div class="text-sm text-muted">RPE: ${w.rpe}/10</div>
                        </div>
                        <div class="text-accent">+${w.calories} kcal</div>
                    </div>
                `).join('') || '<p class="text-muted">No recent workouts.</p>'}
            </div>
        `;
    },

    buildFilterOptions: () => {
        if (router.filterOptions) return router.filterOptions;
        
        const forces = new Set();
        const mechanics = new Set();
        const equipment = new Set();
        const primaryMuscles = new Set();
        const secondaryMuscles = new Set();
        const categories = new Set();

        allExercises.forEach(e => {
            if (e.force) forces.add(e.force);
            if (e.mechanic) mechanics.add(e.mechanic);
            if (e.equipment) equipment.add(e.equipment);
            if (e.category) categories.add(e.category);
            if (e.primaryMuscles) e.primaryMuscles.forEach(m => primaryMuscles.add(m));
            if (e.secondaryMuscles) e.secondaryMuscles.forEach(m => secondaryMuscles.add(m));
        });

        router.filterOptions = {
            force: Array.from(forces).sort(),
            mechanic: Array.from(mechanics).sort(),
            equipment: Array.from(equipment).sort(),
            primaryMuscles: Array.from(primaryMuscles).sort(),
            secondaryMuscles: Array.from(secondaryMuscles).sort(),
            category: Array.from(categories).sort()
        };
        
        return router.filterOptions;
    },

    renderFilter: (container) => {
        const opts = router.buildFilterOptions();
        const f = state.filters;

        const renderCheckboxGroup = (title, key, options) => {
            const allChecked = options.length > 0 && options.every(opt => f[key].includes(opt));
            return `
                <div class="filter-group">
                    <div class="filter-header">
                        <h4 class="filter-title">${title}</h4>
                        <button class="select-all-btn ${allChecked ? 'active' : ''}" onclick="router.toggleSelectAll('${key}', ${JSON.stringify(options).replace(/"/g, "'")})">
                            ${allChecked ? 'Deselect All' : 'Select All'}
                        </button>
                    </div>
                    <div class="filter-options">
                        ${options.map(opt => `
                            <label class="filter-option ${f[key].includes(opt) ? 'selected' : ''}">
                                <input type="checkbox" ${f[key].includes(opt) ? 'checked' : ''} 
                                    onchange="router.toggleFilter('${key}', '${opt}', this.checked)">
                                ${opt}
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
        };

        const calculateCounts = () => {
            let mainCount = 0;
            let warmupCount = 0;
            
            allExercises.forEach(e => {
                if (Logic.matchesFilters(e)) {
                    if (e.warmup) warmupCount++;
                    else mainCount++;
                }
            });
            
            return { main: mainCount, warmup: warmupCount, total: mainCount + warmupCount };
        };

        const counts = calculateCounts();

        const getCountColor = (count) => {
            if (count >= 500) return 'var(--accent)';
            if (count >= 200) return 'var(--primary)';
            if (count >= 50) return '#f59e0b';
            return 'var(--danger)';
        };

        const updateCounts = () => {
            const newCounts = calculateCounts();
            document.getElementById('countMain').innerText = newCounts.main;
            document.getElementById('countMain').style.color = getCountColor(newCounts.main);
            document.getElementById('countWarmup').innerText = '+ ' + newCounts.warmup;
            document.getElementById('countWarmup').style.color = getCountColor(newCounts.warmup);
            document.getElementById('countTotal').innerText = '= ' + newCounts.total;
            document.getElementById('countTotal').style.color = getCountColor(newCounts.total);
        };

        container.innerHTML = `
            <div class="scroll-container filter-container">
                <h1 class="text-2xl mb-4">Configure Workout</h1>
                <p class="text-sm text-muted mb-4">Filter exercises or leave all unchecked for full selection</p>
                
                ${renderCheckboxGroup('Force', 'force', opts.force)}
                ${renderCheckboxGroup('Mechanic', 'mechanic', opts.mechanic)}
                ${renderCheckboxGroup('Equipment', 'equipment', opts.equipment)}
                ${renderCheckboxGroup('Category', 'category', opts.category)}
                ${renderCheckboxGroup('Primary Muscles', 'primaryMuscles', opts.primaryMuscles)}
                ${renderCheckboxGroup('Secondary Muscles', 'secondaryMuscles', opts.secondaryMuscles)}
                
                <div class="filter-group">
                    <div class="filter-header">
                        <h4 class="filter-title">Noise Level</h4>
                        <button class="select-all-btn ${f.quiet.length === 2 ? 'active' : ''}" onclick="router.toggleSelectAll('quiet', ['true','false'])">
                            ${f.quiet.length === 2 ? 'Deselect All' : 'Select All'}
                        </button>
                    </div>
                    <div class="filter-options">
                        <label class="filter-option ${f.quiet.includes('true') ? 'selected' : ''}">
                            <input type="checkbox" ${f.quiet.includes('true') ? 'checked' : ''} 
                                onchange="router.toggleFilter('${'quiet'}', '${'true'}', this.checked)">
                            Quiet
                        </label>
                        <label class="filter-option ${f.quiet.includes('false') ? 'selected' : ''}">
                            <input type="checkbox" ${f.quiet.includes('false') ? 'checked' : ''} 
                                onchange="router.toggleFilter('${'quiet'}', '${'false'}', this.checked)">
                            Loud/Jumping
                        </label>
                    </div>
                </div>

                <div class="filter-count-display" id="filterCountDisplay">
                    <div class="count-main" id="countMain" style="color: ${getCountColor(counts.main)}">${counts.main}</div>
                    <div class="count-warmup" id="countWarmup" style="color: ${getCountColor(counts.warmup)}">+ ${counts.warmup}</div>
                    <div class="count-total" id="countTotal" style="color: ${getCountColor(counts.total)}">= ${counts.total}</div>
                </div>

                <div class="filter-actions">
                    <button class="btn btn-danger" onclick="router.resetFilters()">Reset Filters</button>
                    <button class="btn btn-primary btn-lg" onclick="router.startWorkout()">Start Workout</button>
                </div>
            </div>
        `;

        window.filterUpdateCounts = updateCounts;
    },

    toggleSelectAll: (key, options) => {
        const allSelected = options.every(opt => state.filters[key].includes(opt));
        
        if (allSelected) {
            state.filters[key] = [];
        } else {
            state.filters[key] = [...options];
        }
        
        store.set('filters', state.filters);
        
        // Update button
        const btnEl = document.querySelector(`button[onclick*="toggleSelectAll('${key}'"]`);
        if (btnEl) {
            btnEl.classList.toggle('active', !allSelected);
            btnEl.innerText = allSelected ? 'Select All' : 'Deselect All';
        }
        
        // Find all checkboxes for this filter and update them
        const checkboxMap = {
            'force': 'Force',
            'mechanic': 'Mechanic',
            'equipment': 'Equipment',
            'category': 'Category',
            'primaryMuscles': 'Primary Muscles',
            'secondaryMuscles': 'Secondary Muscles',
            'quiet': 'Noise Level'
        };
        
        const groupTitle = checkboxMap[key];
        if (groupTitle) {
            document.querySelectorAll('.filter-group').forEach(group => {
                const title = group.querySelector('.filter-title');
                if (title && title.innerText === groupTitle) {
                    group.querySelectorAll('.filter-option').forEach(label => {
                        const checkbox = label.querySelector('input');
                        if (checkbox) {
                            // Match pattern: router.toggleFilter('key', 'value', this.checked)
                            const onchange = checkbox.getAttribute('onchange') || '';
                            const match = onchange.match(/toggleFilter\('([^']+)',\s*'([^']+)'/);
                            if (match) {
                                const [, k, v] = match;
                                label.classList.toggle('selected', state.filters[k].includes(v));
                            }
                        }
                    });
                }
            });
        }
        
        if (window.filterUpdateCounts) {
            window.filterUpdateCounts();
        }
    },

    toggleFilter: (key, value, checked) => {
        const idx = state.filters[key].indexOf(value);
        if (checked && idx === -1) {
            state.filters[key].push(value);
        } else if (!checked && idx !== -1) {
            state.filters[key].splice(idx, 1);
        }
        store.set('filters', state.filters);
        
        // Update the checkbox UI
        const optionEls = document.querySelectorAll(`input[onchange*="'${key}', '${value}'"]`);
        optionEls.forEach(el => {
            const label = el.closest('.filter-option');
            if (label) {
                label.classList.toggle('selected', checked);
            }
        });
        
        // Update select all button state
        const opts = router.filterOptions || {};
        const options = opts[key] || [];
        if (options.length > 0) {
            const allSelected = options.every(opt => state.filters[key].includes(opt));
            const btnEl = document.querySelector(`button[onclick*="toggleSelectAll('${key}'"]`);
            if (btnEl) {
                btnEl.classList.toggle('active', !allSelected);
                btnEl.innerText = allSelected ? 'Select All' : 'Deselect All';
            }
        }
        
        if (window.filterUpdateCounts) {
            window.filterUpdateCounts();
        }
    },

    resetFilters: () => {
        state.filters = {
            force: [],
            mechanic: [],
            equipment: [],
            primaryMuscles: [],
            secondaryMuscles: [],
            category: [],
            quiet: []
        };
        store.set('filters', state.filters);
        
        // Update all checkbox states visually
        document.querySelectorAll('.filter-option').forEach(el => {
            el.classList.remove('selected');
            const checkbox = el.querySelector('input');
            if (checkbox) checkbox.checked = false;
        });
        document.querySelectorAll('.select-all-btn').forEach(el => {
            el.classList.remove('active');
            el.innerText = 'Select All';
        });
        
        if (window.filterUpdateCounts) {
            window.filterUpdateCounts();
        }
    },

    startWorkout: () => {
        if (!allExercises || allExercises.length === 0) {
            alert('Exercises are still loading. Please wait.');
            return;
        }
        
        const filteredCount = allExercises.filter(e => !e.warmup && Logic.matchesFilters(e)).length;
        
        if (filteredCount < 6) {
            alert(`Not enough exercises match your filters (${filteredCount} found). Please loosen your filters.`);
            return;
        }
        
        router.activeWorkout = Logic.generateWorkout();
        router.navigate('workout');
    },

    renderWorkout: (container) => {
        let phase = 'warmup';
        let idx = 0;
        let timeLeft = 20;
        let isPaused = false;
        const wo = router.activeWorkout;
        let currentEx = wo.warmups[0];
        let currentImageIndex = 0;

        const speak = (txt) => {
            if('speechSynthesis' in window) {
                const u = new SpeechSynthesisUtterance(txt);
                window.speechSynthesis.speak(u);
            }
        };

        const tick = () => {
            if(isPaused) return;
            timeLeft--;
            updateUI();
            if(timeLeft <= 0) nextPhase();
        };

        const nextPhase = () => {
            if (phase === 'warmup') {
                idx++;
                if(idx >= wo.warmups.length) {
                    phase = 'work';
                    idx = 0;
                    currentEx = wo.main[idx];
                    currentImageIndex = 0;
                    timeLeft = 30;
                    speak(currentEx.name);
                } else {
                    currentEx = wo.warmups[idx];
                    timeLeft = 20;
                    speak(currentEx.name);
                }
            } else if (phase === 'work') {
                phase = 'rest';
                timeLeft = 10;
                speak("Rest");
            } else if (phase === 'rest') {
                idx++;
                if(idx >= wo.main.length) {
                    finishWorkout();
                    return;
                }
                phase = 'work';
                currentEx = wo.main[idx];
                currentImageIndex = 0;
                timeLeft = 30;
                speak(currentEx.name);
            }
            updateUI();
        };

        const finishWorkout = () => {
            clearInterval(router.timer);
            container.innerHTML = `
                <div class="p-4 flex flex-col h-full justify-center text-center">
                    <h1 class="text-2xl mb-4 text-accent">Workout Complete!</h1>
                    <p class="mb-6 text-muted">Rate overall difficulty (RPE)</p>
                    
                    <div class="mb-8">
                        <div class="flex justify-between text-sm mb-2 text-muted">
                            <span>Very Easy</span>
                            <span>Extreme</span>
                        </div>
                        <input type="range" id="rpeSlider" min="1" max="10" value="5">
                        <div class="text-center text-3xl mt-2 font-bold text-primary" id="rpeValue">5</div>
                    </div>

                    <button class="btn btn-primary btn-lg" onclick="router.saveWorkout(document.getElementById('rpeSlider').value)">
                        Save & Calculate Calories
                    </button>
                </div>
            `;
            document.getElementById('rpeSlider').oninput = (e) => {
                document.getElementById('rpeValue').innerText = e.target.value;
            };
        };

        const getInstructions = (exercise) => {
            if (exercise.instructions && Array.isArray(exercise.instructions)) {
                return exercise.instructions.join(' ');
            }
            return exercise.desc || exercise.description || '';
        };

        const updateUI = () => {
            document.getElementById('timerDisplay').innerText = timeLeft;
            document.getElementById('exName').innerText = currentEx.name;
            document.getElementById('exDifficulty').innerText = `Difficulty: ${Logic.getEffectiveDifficulty(currentEx)}/10`;
            document.getElementById('exInstructions').innerText = getInstructions(currentEx);
            document.getElementById('phaseLabel').innerText = phase.toUpperCase();
            
            if(phase === 'warmup') document.getElementById('progressLabel').innerText = `${idx+1}/${wo.warmups.length}`;
            else if(phase !== 'rest') document.getElementById('progressLabel').innerText = `${idx+1}/${wo.main.length}`;

            const fbControls = document.getElementById('fbControls');
            const fbMsg = document.getElementById('fbMsg');
            
            if(phase === 'rest') {
                if(fbControls.classList.contains('hidden') && fbMsg.classList.contains('hidden')) {
                    fbControls.classList.remove('hidden');
                    fbControls.classList.add('visible');
                    document.getElementById('exSlider').value = 5; 
                    router.tempScore = 5;
                }
            } else {
                fbControls.classList.remove('visible');
                fbControls.classList.add('hidden');
            }

            updateImage();
        };

        const updateImage = () => {
            const imgContainer = document.getElementById('exerciseImage');
            const imgDots = document.getElementById('imageDots');
            if (!imgContainer || !imgDots) return;

            const images = getImages(currentEx);
            
            imgContainer.innerHTML = `<img src="${images[currentImageIndex]}" alt="${currentEx.name}" class="exercise-image" onclick="router.switchNextImage()" onerror="this.style.display='none'">`;
            
            imgDots.innerHTML = images.map((_, i) => 
                `<span class="dot ${i === currentImageIndex ? 'active' : ''}" onclick="router.switchImage(${i})"></span>`
            ).join('');
        };

        container.innerHTML = `
            <div class="flex flex-col h-full p-4 relative">
                <div class="flex justify-between items-center mb-2">
                    <button class="btn text-sm" onclick="router.quitWorkout()">Quit</button>
                    <div class="text-center">
                        <div class="uppercase text-xs tracking-widest text-muted" id="phaseLabel">Warmup</div>
                        <div class="text-xs" id="progressLabel">1/${wo.warmups.length}</div>
                    </div>
                </div>

                <div class="exercise-image-container" id="exerciseImage"></div>
                <div class="image-dots" id="imageDots"></div>

                <div class="flex-1 flex flex-col items-center justify-center">
                    <h2 class="text-2xl text-center mb-1" id="exName">${currentEx.name}</h2>
                    <div class="text-xs text-accent mb-2" id="exDifficulty"></div>
                    <p class="text-sm text-muted text-center mb-4 px-2" style="min-height: 3em;" id="exInstructions">${getInstructions(currentEx)}</p>
                    
                    <div class="timer-circle">
                        <div class="progress-ring" id="pRing"></div>
                        <div class="text-5xl font-bold" id="timerDisplay">${timeLeft}</div>
                    </div>
                </div>

                <div class="feedback-container" id="fbContainer">
                    <div id="fbControls" class="hidden w-full">
                        <p class="text-sm text-center mb-2 text-muted">How hard was that?</p>
                        <div class="flex justify-between text-xs text-muted px-2">
                            <span>Easy (1)</span>
                            <span>Hard (10)</span>
                        </div>
                        <input type="range" id="exSlider" min="1" max="10" value="5" onchange="router.tempScore=this.value">
                        <button class="btn btn-primary w-full mt-2" onclick="router.submitExFeedback()">Submit</button>
                    </div>
                    <div id="fbMsg" class="hidden text-center text-accent w-full">Feedback Saved</div>
                </div>

                <div class="flex gap-4 mt-2">
                    <button class="btn btn-lg flex-1" id="pauseBtn">Pause</button>
                    <button class="btn btn-lg btn-primary flex-1" id="skipBtn">Skip</button>
                </div>
            </div>
        `;

        document.getElementById('pauseBtn').onclick = () => {
            isPaused = !isPaused;
            document.getElementById('pauseBtn').innerText = isPaused ? "Resume" : "Pause";
        };
        document.getElementById('skipBtn').onclick = () => { timeLeft = 1; };

        router.tempScore = 5;
        router.submitExFeedback = () => {
            const ex = wo.main[idx];
            if(!state.exerciseFeedback[ex.id]) state.exerciseFeedback[ex.id] = { avgScore: 5, count: 0 };
            
            const old = state.exerciseFeedback[ex.id];
            const newAvg = ((old.avgScore * old.count) + parseInt(router.tempScore)) / (old.count + 1);
            state.exerciseFeedback[ex.id] = { avgScore: newAvg, count: old.count + 1 };
            store.set('ex_feedback', state.exerciseFeedback);

            document.getElementById('fbControls').classList.remove('visible');
            document.getElementById('fbControls').classList.add('hidden');
            
            const msg = document.getElementById('fbMsg');
            msg.classList.remove('hidden');
            msg.classList.add('visible');
            setTimeout(() => {
                msg.classList.remove('visible');
                msg.classList.add('hidden');
            }, 1000);
        };

        router.quitWorkout = () => {
            if(confirm("Quit workout?")) {
                clearInterval(router.timer);
                router.navigate('home');
            }
        };

        router.switchImage = (index) => {
            currentImageIndex = index;
            updateImage();
        };

        router.switchNextImage = () => {
            const images = getImages(currentEx);
            currentImageIndex = (currentImageIndex + 1) % images.length;
            updateImage();
        };

        timeLeft = 20;
        speak(currentEx.name);
        updateUI();
        router.timer = setInterval(tick, 1000);
    },

    saveWorkout: (rpe) => {
        const userWeight = state.settings.weight;
        const rpeVal = parseInt(rpe);
        const totalTimeSec = router.activeWorkout.totalTime;
        const totalTimeHours = totalTimeSec / 3600;
        
        let totalCalories = 0;
        
        router.activeWorkout.main.forEach((ex) => {
            const met = getMetForExercise(ex, false);
            const exerciseDurationSec = 30;
            const exerciseDurationHours = exerciseDurationSec / 3600;
            const exerciseCalories = met * userWeight * exerciseDurationHours;
            totalCalories += exerciseCalories;
        });
        
        router.activeWorkout.warmups.forEach((ex) => {
            const met = getMetForExercise(ex, true);
            const exerciseDurationSec = 20;
            const exerciseDurationHours = exerciseDurationSec / 3600;
            const exerciseCalories = met * userWeight * exerciseDurationHours;
            totalCalories += exerciseCalories;
        });
        
        totalCalories = Math.round(totalCalories);

        const w = {
            date: Date.now(),
            rpe: rpeVal,
            calories: totalCalories
        };
        state.workouts.push(w);
        store.set('workouts', state.workouts);
        router.navigate('home');
    },

    renderStats: (container) => {
        container.innerHTML = `
            <div class="scroll-container">
                <h1 class="text-2xl mb-4">Analysis</h1>
                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">Difficulty Trend (RPE)</h3>
                    <canvas id="rpeChart"></canvas>
                </div>
                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">Calories Burned</h3>
                    <canvas id="calChart"></canvas>
                </div>
            </div>
        `;
        setTimeout(() => {
            const rpeData = state.workouts.map(w => w.rpe);
            const calData = state.workouts.map(w => w.calories);
            Chart.draw('rpeChart', rpeData, '#10b981');
            Chart.draw('calChart', calData, '#ef4444');
        }, 100);
    },

    renderAlgo: (container) => {
        const bias = state.settings.difficultyBias;
        container.innerHTML = `
            <div class="scroll-container">
                <h1 class="text-2xl mb-4">How it Works</h1>
                
                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">1. Adaptive Difficulty Algorithm</h3>
                    <p class="text-sm text-muted mb-4">The app analyzes your last 5 workouts to determine your current fitness level. Based on your average RPE (Rate of Perceived Exertion), it adjusts the workout intensity:</p>
                    <ul class="text-sm text-muted" style="padding-left:16px;">
                        <li class="mb-2"><strong>RPE &lt; 5:</strong> You're finding workouts too easy → Difficulty increases</li>
                        <li class="mb-2"><strong>RPE 5-8:</strong> Perfect effort → Difficulty stays optimal</li>
                        <li class="mb-2"><strong>RPE &gt; 8:</strong> Too hard → Difficulty decreases</li>
                    </ul>
                </div>

                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">2. Personalized Exercise Ratings</h3>
                    <p class="text-sm text-muted mb-4">After each exercise during rest periods, you can rate how hard it felt. The algorithm learns your personal strengths and weaknesses:</p>
                    <ul class="text-sm text-muted" style="padding-left:16px;">
                        <li class="mb-2"><strong>High rating (8-10):</strong> Exercise is harder for you than average → Algorithm increases its effective difficulty for future workouts</li>
                        <li class="mb-2"><strong>Low rating (1-3):</strong> Exercise is easier for you than average → Algorithm decreases its effective difficulty</li>
                    </ul>
                </div>

                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">3. Warmup Selection</h3>
                    <p class="text-sm text-muted mb-4">Every workout starts with 3 warmup exercises selected from our library of stretching and mobility exercises. Warmups automatically respect your filter settings but are always included to prepare your muscles.</p>
                </div>

                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">4. Main Workout Selection</h3>
                    <p class="text-sm text-muted mb-4">12 exercises are selected targeting all major muscle groups for a balanced full-body workout:</p>
                    <ul class="text-sm text-muted" style="padding-left:16px;">
                        <li class="mb-2">4 Upper body exercises (chest, back, shoulders, arms)</li>
                        <li class="mb-2">4 Lower body exercises (quads, hamstrings, glutes, calves)</li>
                        <li class="mb-2">2 Core exercises (abs, obliques)</li>
                        <li class="mb-2">2 Cardio exercises (for calorie burn)</li>
                    </ul>
                </div>

                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">5. Calorie Calculation</h3>
                    <p class="text-sm text-muted mb-4">Calories are calculated using the scientifically-validated MET formula:</p>
                    <ul class="text-sm text-muted" style="padding-left:16px;">
                        <li class="mb-2"><strong>MET Value:</strong> Each exercise has a MET (Metabolic Equivalent) based on intensity (1-10 scale). 1 MET = your resting calorie burn.</li>
                        <li class="mb-2"><strong>Formula:</strong> Calories = MET × Weight(kg) × Duration(hours)</li>
                        <li class="mb-2"><strong>Example:</strong> 70kg person, MET 6, 30 seconds → 6 × 70 × (30/3600) = 3.5 calories per exercise</li>
                        <li class="mb-2"><strong>Total:</strong> 12 main exercises (30s each) + 3 warmups (20s each) = ~40-80 calories total</li>
                        <li class="mb-2"><strong>Note:</strong> This is a 7-minute workout - calorie burn is naturally limited by time. Higher MET exercises burn more, but realistic totals are 40-100 calories.</li>
                    </ul>
                </div>

                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">6. Filter System</h3>
                    <p class="text-sm text-muted mb-4">Before each workout, you can filter exercises by:</p>
                    <ul class="text-sm text-muted" style="padding-left:16px;">
                        <li class="mb-2"><strong>Force:</strong> push, pull, or static exercises</li>
                        <li class="mb-2"><strong>Mechanic:</strong> compound or isolation movements</li>
                        <li class="mb-2"><strong>Equipment:</strong> body only, dumbbell, barbell, machine, etc.</li>
                        <li class="mb-2"><strong>Category:</strong> strength, stretching, cardio, etc.</li>
                        <li class="mb-2"><strong>Muscles:</strong> specific muscle groups</li>
                        <li class="mb-2"><strong>Noise:</strong> quiet vs loud/jumping exercises</li>
                    </ul>
                </div>

                <div class="card">
                    <h3 class="text-sm text-muted uppercase mb-2">Your Bias Status</h3>
                    <div class="flex justify-between text-sm mb-1">
                        <span>Recovery Mode</span>
                        <span>High Intensity</span>
                    </div>
                    <div class="w-full bg-card-border h-2 rounded overflow-hidden">
                        <div style="width: ${((bias + 2) / 4.5) * 100}%; background: var(--primary); height: 100%"></div>
                    </div>
                    <p class="text-xs text-muted mt-2">Algorithm Bias: ${bias.toFixed(2)} (Target Difficulty: ${Math.max(0, Math.min(10, Math.round(5 + bias * 2)))}/10)</p>
                </div>
            </div>
        `;
    },

    renderLibrary: (container) => {
        const listHtml = allExercises.slice(0, 100).map(e => {
            const effectiveDiff = Logic.getEffectiveDifficulty(e);
            const warmupBadge = e.warmup ? '<span class="tag tag-warmup">WARMUP</span>' : '';
            const customBadge = e.custom ? '<span class="tag tag-custom">CUSTOM</span>' : '';
            return `
                <div class="list-item">
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-bold">${e.name}</span>
                        <div class="flex items-center gap-2">
                            ${warmupBadge}
                            ${customBadge}
                            <span class="tag ${effectiveDiff <= 3 ? 'tag-easy' : (effectiveDiff <= 6 ? 'tag-med' : 'tag-hard')}">
                                ${effectiveDiff}/10
                            </span>
                        </div>
                    </div>
                    <div class="text-xs text-muted mb-1">${e.category || 'N/A'} | ${e.equipment || 'N/A'}</div>
                    <p class="text-xs text-muted">${e.primaryMuscles ? e.primaryMuscles.join(', ') : ''}</p>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="scroll-container">
                <h1 class="text-2xl mb-4">Exercise Library</h1>
                <p class="text-sm text-muted mb-4">${allExercises.length} Exercises Available</p>
                <div class="card" style="padding:0">
                    ${listHtml}
                </div>
            </div>
        `;
    },

    renderCustom: (container) => {
        container.innerHTML = `
            <div class="scroll-container">
                <h1 class="text-2xl mb-4">Add Custom Exercise</h1>
                
                <div class="card">
                    <label class="text-sm text-muted block mb-2">Exercise Name *</label>
                    <input type="text" id="customName" class="btn w-full text-left" placeholder="e.g., Custom Push-up">
                </div>
                
                <div class="card">
                    <label class="text-sm text-muted block mb-2">Difficulty (0-10) *</label>
                    <input type="number" id="customDiff" class="btn w-full text-left" min="0" max="10" value="5">
                </div>
                
                <div class="card">
                    <label class="text-sm text-muted block mb-2">Description *</label>
                    <textarea id="customDesc" class="btn w-full text-left" rows="2" placeholder="Describe how to perform the exercise"></textarea>
                </div>
                
                <div class="card">
                    <label class="text-sm text-muted block mb-2">Category</label>
                    <select id="customCategory" class="btn w-full text-left">
                        <option value="strength">Strength</option>
                        <option value="cardio">Cardio</option>
                        <option value="stretching">Stretching</option>
                        <option value="plyometrics">Plyometrics</option>
                    </select>
                </div>
                
                <div class="card">
                    <label class="text-sm text-muted block mb-2">Equipment</label>
                    <select id="customEquipment" class="btn w-full text-left">
                        <option value="body only">Body Only</option>
                        <option value="dumbbell">Dumbbell</option>
                        <option value="barbell">Barbell</option>
                        <option value="machine">Machine</option>
                        <option value="kettlebell">Kettlebell</option>
                        <option value="cable">Cable</option>
                        <option value="bands">Bands</option>
                        <option value="medicine ball">Medicine Ball</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                
                <div class="card">
                    <label class="text-sm text-muted block mb-2">Primary Muscles (hold Ctrl to select multiple)</label>
                    <select id="customPrimaryMuscles" class="btn w-full text-left" multiple style="height: 120px;">
                        <option value="chest">Chest</option>
                        <option value="back">Back</option>
                        <option value="shoulders">Shoulders</option>
                        <option value="biceps">Biceps</option>
                        <option value="triceps">Triceps</option>
                        <option value="forearms">Forearms</option>
                        <option value="quadriceps">Quadriceps</option>
                        <option value="hamstrings">Hamstrings</option>
                        <option value="glutes">Glutes</option>
                        <option value="calves">Calves</option>
                        <option value="abdominals">Abs</option>
                        <option value="obliques">Obliques</option>
                    </select>
                </div>
                
                <div class="card">
                    <label class="flex items-center gap-2">
                        <input type="checkbox" id="customQuiet" checked>
                        <span class="text-sm text-muted">Quiet Exercise (no jumping/loud noise)</span>
                    </label>
                </div>
                
                <div class="card">
                    <label class="flex items-center gap-2">
                        <input type="checkbox" id="customWarmup">
                        <span class="text-sm text-muted">Warmup Exercise</span>
                    </label>
                </div>
                
                <button class="btn btn-primary btn-lg w-full mt-4" onclick="router.addCustomExercise()">Add Exercise</button>
                
                <h3 class="text-xl mt-4 mb-2">Your Custom Exercises</h3>
                ${state.customExercises.map(e => `
                    <div class="card flex justify-between items-center">
                        <div>
                            <div class="font-bold">${e.name}</div>
                            <div class="text-sm text-muted">${e.difficulty}/10 | ${e.category} | ${e.primaryMuscles ? e.primaryMuscles.join(', ') : 'N/A'}</div>
                        </div>
                        <button class="btn btn-danger" onclick="router.deleteCustomExercise('${e.id}')">Delete</button>
                    </div>
                `).join('') || '<p class="text-muted">No custom exercises yet.</p>'}
            </div>
        `;
    },

    addCustomExercise: () => {
        const name = document.getElementById('customName').value.trim();
        const diff = parseInt(document.getElementById('customDiff').value);
        const desc = document.getElementById('customDesc').value.trim();
        const category = document.getElementById('customCategory').value;
        const equipment = document.getElementById('customEquipment').value;
        const quiet = document.getElementById('customQuiet').checked;
        const isWarmup = document.getElementById('customWarmup').checked;
        
        const primarySelect = document.getElementById('customPrimaryMuscles');
        const primaryMuscles = Array.from(primarySelect.selectedOptions).map(opt => opt.value);
        
        if (!name || isNaN(diff) || diff < 0 || diff > 10 || !desc) {
            alert('Please fill in all required fields (Name, Difficulty, Description).');
            return;
        }
        const id = name.replace(/\s/g, '').toLowerCase() + '_' + Date.now();
        if (state.customExercises.some(e => e.id === id)) {
            alert('Exercise already exists.');
            return;
        }
        
        const newEx = { 
            name, 
            difficulty: diff, 
            desc, 
            id, 
            met: getMetForExercise({difficulty: diff, quiet, category}, isWarmup),
            quiet, 
            warmup: isWarmup, 
            category, 
            equipment,
            primaryMuscles,
            secondaryMuscles: [],
            force: category === 'stretching' ? 'static' : (category === 'cardio' ? 'push' : 'pull'),
            custom: true
        };
        
        state.customExercises.push(newEx);
        store.set('custom_exercises', state.customExercises);
        allExercises.push(newEx);
        if (isWarmup) {
            warmupExercises.push(newEx);
        }
        router.renderCustom(document.getElementById('app'));
    },

    deleteCustomExercise: (id) => {
        const exercise = state.customExercises.find(e => e.id === id);
        state.customExercises = state.customExercises.filter(e => e.id !== id);
        store.set('custom_exercises', state.customExercises);
        allExercises = allExercises.filter(e => e.id !== id);
        warmupExercises = warmupExercises.filter(e => e.id !== id);
        router.renderCustom(document.getElementById('app'));
    },

    renderSettings: (container) => {
        container.innerHTML = `
            <div class="scroll-container">
                <h1 class="text-2xl mb-4">Settings</h1>
                <div class="card">
                    <label class="text-sm text-muted block mb-2">Weight (kg) - For Calorie Calculation</label>
                    <input type="number" value="${state.settings.weight}" class="btn w-full text-left" onchange="state.settings.weight=parseFloat(this.value); store.set('settings', state.settings)">
                </div>
                <div class="card">
                    <button class="btn btn-danger w-full" onclick="if(confirm('Reset all data including workouts, custom exercises, and settings?')){ localStorage.clear(); location.reload(); }">Reset All Data</button>
                </div>
            </div>
        `;
    }
};

window.router = router;

exerciseLoader.loadAll().then(() => {
    router.navigate('home');
});