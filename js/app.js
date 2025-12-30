        let exercises = [];
        let warmups = [];

        fetch('data/exercises.json')
            .then(response => response.json())
            .then(data => {
                warmups = data.warmupNames.map(w => ({ name: w.name, diff: 1, desc: w.desc, id: w.name.replace(/\s/g, '').toLowerCase() }));
                const rawExercises = data.rawExercises;
                exercises = rawExercises.map(e => ({
                    name: e.n,
                    diff: e.d,
                    desc: e.desc,
                    id: e.n.replace(/\s/g, '').toLowerCase()
                }));

                // --- STATE & STORAGE ---
        const store = {
            get: (key, def) => JSON.parse(localStorage.getItem(key) || JSON.stringify(def)),
            set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
        };

        let state = {
            workouts: store.get('workouts', []),
            settings: store.get('settings', { weight: 70, difficultyBias: 0 }),
            exerciseFeedback: store.get('ex_feedback', {}), // { exId: { avgScore: 5, count: 0 } }
            customExercises: store.get('custom_exercises', [])
        };

                exercises.push(...state.customExercises);

        // --- CHARTING ENGINE ---
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

        // --- LOGIC ---
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

            generateWorkout: () => {
                const bias = Logic.analyzeUser();
                state.settings.difficultyBias = bias;
                store.set('settings', state.settings);

                // Warmups
                const selectedWarmups = [];
                const wuPool = [...warmups];
                for(let i=0; i<3; i++) {
                    const idx = Math.floor(Math.random() * wuPool.length);
                    selectedWarmups.push(wuPool.splice(idx, 1)[0]);
                }

                // Exercises Logic
                // 1. Determine Target Difficulty based on global bias (0-10 scale)
                let targetDiff = Math.max(0, Math.min(10, 5 + bias * 2));

                // 2. Filter exercises based on closeness to target difficulty
                let pool = exercises.filter(e => {
                    const fb = state.exerciseFeedback[e.id];
                    let effectiveDiff = e.diff;
                    if (fb) {
                        if (fb.avgScore >= 8) effectiveDiff += 1;
                        if (fb.avgScore <= 3) effectiveDiff -= 1;
                    }
                    effectiveDiff = Math.max(0, Math.min(10, effectiveDiff));
                    return Math.abs(effectiveDiff - targetDiff) <= 3;
                });

                // 3. Sort by closeness to target
                pool.sort((a,b) => {
                    const getEff = (ex) => {
                        const fb = state.exerciseFeedback[ex.id];
                        let eff = ex.diff;
                        if(fb && fb.avgScore >= 8) eff += 1;
                        if(fb && fb.avgScore <= 3) eff -= 1;
                        return Math.max(0, Math.min(10, eff));
                    };
                    const distA = Math.abs(getEff(a) - targetDiff) + Math.random();
                    const distB = Math.abs(getEff(b) - targetDiff) + Math.random();
                    return distA - distB;
                });

                const selectedExercises = pool.slice(0, 12);
                // Shuffle for variety
                for (let i = selectedExercises.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [selectedExercises[i], selectedExercises[j]] = [selectedExercises[j], selectedExercises[i]];
                }

                return {
                    warmups: selectedWarmups,
                    main: selectedExercises,
                    totalTime: (selectedExercises.length * 40) + (selectedWarmups.length * 30)
                };
            }
        };

        // --- ROUTER ---
        const router = {
            current: 'home',
            activeWorkout: null,
            timer: null,
            tempScore: 5,

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
                
                // Nav UI
                const navMap = { 'home':0, 'library':1, 'stats':2, 'algo':3, 'custom':4, 'settings':5 };
                if(navMap[view] !== undefined) document.querySelectorAll('.nav-item')[navMap[view]].classList.add('active');
                
                document.getElementById('mainNav').style.display = view === 'workout' ? 'none' : 'flex';
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

                        <button class="btn btn-primary btn-lg" onclick="router.startWorkout()">
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

            startWorkout: () => {
                if (!exercises || exercises.length === 0) {
                    alert('Exercises are still loading. Please wait.');
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

                const tick = () => {
                    if(isPaused) return;
                    timeLeft--;
                    updateUI();
                    if(timeLeft <= 0) nextPhase();
                };

                const nextPhase = () => {
                    // Logic to switch phases
                    if (phase === 'warmup') {
                        idx++;
                        if(idx >= wo.warmups.length) {
                            phase = 'work';
                            idx = 0;
                            currentEx = wo.main[idx];
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

                const speak = (txt) => {
                    if('speechSynthesis' in window) {
                        const u = new SpeechSynthesisUtterance(txt);
                        window.speechSynthesis.speak(u);
                    }
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

                        <div class="flex-1 flex flex-col items-center justify-center">
                            <h2 class="text-2xl text-center mb-2" id="exName">${currentEx.name}</h2>
                            <p class="text-sm text-muted text-center mb-4 px-2" style="min-height: 3em;" id="exDesc">${currentEx.desc}</p>
                            
                            <div class="timer-circle">
                                <div class="progress-ring" id="pRing"></div>
                                <div class="text-5xl font-bold" id="timerDisplay">${timeLeft}</div>
                            </div>
                        </div>

                        <!-- STABLE FEEDBACK CONTAINER -->
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

                const updateUI = () => {
                    document.getElementById('timerDisplay').innerText = timeLeft;
                    document.getElementById('exName').innerText = currentEx.name;
                    document.getElementById('exDesc').innerText = currentEx.desc;
                    document.getElementById('phaseLabel').innerText = phase.toUpperCase();
                    
                    if(phase === 'warmup') document.getElementById('progressLabel').innerText = `${idx+1}/${wo.warmups.length}`;
                    else if(phase !== 'rest') document.getElementById('progressLabel').innerText = `${idx+1}/${wo.main.length}`;

                    const fbControls = document.getElementById('fbControls');
                    const fbMsg = document.getElementById('fbMsg');
                    
                    if(phase === 'rest') {
                        // Show slider if not already shown/submitted
                        if(fbControls.classList.contains('hidden') && fbMsg.classList.contains('hidden')) {
                            fbControls.classList.remove('hidden');
                            fbControls.classList.add('visible');
                            document.getElementById('exSlider').value = 5; 
                            router.tempScore = 5;
                        }
                    } else {
                        // Hide all
                        fbControls.classList.remove('visible');
                        fbControls.classList.add('hidden');
                    }
                };

                timeLeft = 20; 
                speak(currentEx.name);
                router.timer = setInterval(tick, 1000);
            },

            saveWorkout: (rpe) => {
                const userWeight = state.settings.weight;
                const rpeVal = parseInt(rpe);
                const estimatedMET = 3 + (rpeVal / 2);
                const durationHrs = 10 / 60; 
                const cals = Math.round(estimatedMET * userWeight * durationHrs);

                const w = {
                    date: Date.now(),
                    rpe: rpeVal,
                    calories: cals
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
                            <h3 class="text-xl mb-2 text-primary">1. Macro-Adjustments</h3>
                            <p class="text-sm text-muted mb-4">The app looks at your last 5 workouts. If your average Rating is below 5, it assumes you are getting stronger and raises the base intensity. If it's above 8, it lowers it to prevent burnout.</p>
                        </div>

                        <div class="card">
                            <h3 class="text-xl mb-2 text-accent">2. Micro-Adjustments (New)</h3>
                            <p class="text-sm text-muted mb-4">This is where your <strong>individual exercise ratings</strong> come in.</p>
                            <ul class="text-sm text-muted" style="padding-left:16px;">
                                <li class="mb-2"><strong>Personalized Difficulty:</strong> If you rate "Push-ups" as a 9/10, the algorithm learns that Push-ups are "Hard" for YOU, regardless of the default setting.</li>
                                <li class="mb-2"><strong>Smart Filtering:</strong> On an "Easy/Recovery" day, the app will specifically hide exercises you have rated highly difficult.</li>
                                <li class="mb-2"><strong>Growth Mode:</strong> On "Hard" days, the app specifically targets exercises you find challenging to force adaptation.</li>
                            </ul>
                        </div>

                        <div class="card">
                            <h3 class="text-xl mb-2">Your Bias Status</h3>
                            <div class="flex justify-between text-sm mb-1">
                                <span>Recovery</span>
                                <span>Hardcore</span>
                            </div>
                            <div class="w-full bg-card-border h-2 rounded overflow-hidden">
                                <div style="width: ${((bias + 2) / 4.5) * 100}%; background: var(--primary); height: 100%"></div>
                            </div>
                            <p class="text-xs text-muted mt-2">Algorithm Bias: ${bias.toFixed(2)}</p>
                        </div>
                    </div>
                `;
            },

            renderLibrary: (container) => {
                const listHtml = exercises.map(e => `
                    <div class="list-item">
                        <div class="flex justify-between items-center mb-1">
                            <span class="font-bold">${e.name}</span>
                            <span class="tag ${e.diff <= 3 ? 'tag-easy' : (e.diff <= 6 ? 'tag-med' : 'tag-hard')}">
                                ${e.diff}/10
                            </span>
                        </div>
                        <p class="text-xs text-muted">${e.desc}</p>
                    </div>
                `).join('');

                container.innerHTML = `
                    <div class="scroll-container">
                        <h1 class="text-2xl mb-4">Exercise Library</h1>
                        <p class="text-sm text-muted mb-4">${exercises.length} Exercises Available</p>
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
                            <label class="text-sm text-muted block mb-2">Exercise Name</label>
                            <input type="text" id="customName" class="btn w-full text-left" placeholder="e.g., Custom Push-up">
                        </div>
                        <div class="card">
                            <label class="text-sm text-muted block mb-2">Difficulty (0-10)</label>
                            <input type="number" id="customDiff" class="btn w-full text-left" min="0" max="10" value="5">
                        </div>
                        <div class="card">
                            <label class="text-sm text-muted block mb-2">Description</label>
                            <textarea id="customDesc" class="btn w-full text-left" rows="3" placeholder="Describe how to perform the exercise"></textarea>
                        </div>
                        <button class="btn btn-primary btn-lg w-full mt-4" onclick="router.addCustomExercise()">Add Exercise</button>
                        <h3 class="text-xl mt-4 mb-2">Your Custom Exercises</h3>
                        ${state.customExercises.map(e => `
                            <div class="card flex justify-between items-center">
                                <div>
                                    <div class="font-bold">${e.name}</div>
                                    <div class="text-sm text-muted">${e.diff}/10</div>
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
                if (!name || isNaN(diff) || diff < 0 || diff > 10) {
                    alert('Please fill all fields correctly.');
                    return;
                }
                const id = name.replace(/\s/g, '').toLowerCase();
                if (state.customExercises.some(e => e.id === id)) {
                    alert('Exercise already exists.');
                    return;
                }
                state.customExercises.push({ name, diff, desc, id });
                store.set('custom_exercises', state.customExercises);
                router.renderCustom(document.getElementById('app'));
            },

            deleteCustomExercise: (id) => {
                state.customExercises = state.customExercises.filter(e => e.id !== id);
                store.set('custom_exercises', state.customExercises);
                router.renderCustom(document.getElementById('app'));
            },

            renderSettings: (container) => {
                container.innerHTML = `
                    <div class="scroll-container">
                        <h1 class="text-2xl mb-4">Settings</h1>
                        <div class="card">
                            <label class="text-sm text-muted block mb-2">Weight (kg) - For Calories</label>
                            <input type="number" value="${state.settings.weight}" class="btn w-full text-left" onchange="state.settings.weight=this.value; store.set('settings', state.settings)">
                        </div>
                        <div class="card">
                            <button class="btn btn-danger w-full" onclick="if(confirm('Reset?')){ localStorage.clear(); location.reload(); }">Reset Data</button>
                        </div>
                    </div>
                `;
            }
        };

        window.router = router;

                // Init
                router.navigate('home');
            });