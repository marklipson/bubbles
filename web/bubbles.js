(function(){
    // overall gravity toward center
    let to_center = 0;   // originally 18
    // closer to 1: free floating, closer to 0: lots of friction - atmospheric friction?
    let v_friction = 0.3;
    // how hard bubbles push one another away when touching
    let bounce = 0.7;
    // how hard bubbles push one another away when close
    let repulsion = 2;
    // thickness of bubble walls
    let bubble_wall = 5;
    // margin around bubbles
    let bubble_outer_margin = 4;
    // overall reduction of force
    let inertia = 0.3;
    // stickiness of background - forces less than this will be ignored
    let bg_friction = 0.4;
    // minimum bubble size
    let min_bubble_r = 15;
    // show grid
    let show_grid = true;
    // available colors
    const r_colors = [
        "black", "gray", "lightgray",
        "red", "deeppink", "crimson",
        "orange", "darkorange", "goldenrod", "brown",
        "yellow",
        "greenyellow",
        "green",
        "darkolivegreen", "darkseagreen",
        "darkturquoise",
        "darkcyan",
        "aqua",
        "blue",
        "darkslateblue",
        "purple"
    ];
    /////////
    // colors
    let sel_color = "rgba(255,255,128,128)";  // "#ffff80";
    let bg_color = "#e0e0e0";
    let grid_color = "#c0c0ff";
    //
    let frame_rate = 40;
    // all bubbles
    let bubbles = [];
    let popped = [];
    let save_popped = true;
    let title = "";
    // start time for previous frame
    let t0 = new Date().getTime();
    //view
    let pan = [0, 0];
    let zoom = 1;
    var move00 = null, move0 = null, move1 = null;
    let the_canvas = null;
    let the_context = null;
    let capture_bubble_click = null;
    let ltd_bubble_index = {};
    function add_bubble(bubble) {
        bubbles.push(bubble);
    }
    function delete_bubble(bubble) {
        const nb = bubbles.indexOf(bubble);
        return bubbles.splice(nb, 1);
    }
    // load/save
    function all_saves() {
        const data = localStorage.getItem("saves");
        if (data === null)
            return [];
        return JSON.parse(data);
    }
    function upd_saves(saves=null) {
        if (saves === null)
            saves = all_saves();
        saves.sort();
        localStorage.setItem("saves", JSON.stringify(saves))
        // update the dropdown
        const save_sel = document.getElementById("saves");
        save_sel.innerHTML = "";
        var opt = document.createElement("option");
        opt.innerText = "---";
        opt.setAttribute("value", "");
        save_sel.appendChild(opt);
        for (var n=0; n < saves.length; n++) {
            var opt = document.createElement("option");
            opt.innerText = saves[n];
            save_sel.appendChild(opt);
        }
    }
    function save(name="") {
        name = name || "default";
        const all = all_saves();
        const data = JSON.stringify({"bubbles": bubbles, "popped": popped});
        localStorage.setItem("save." + name, data);
        // make sure the save is listed
        if (all.indexOf(name) < 0) {
            all.push(name);
            upd_saves(all);
        }
    }
    function load(name="") {
        name = name || "default";
        title = name;
        const edt_title = document.getElementById("title");
        edt_title.value = name;
        const data = JSON.parse(localStorage.getItem("save." + name));
        if (data === null)
            return;
        bubbles = []
        for (var nb=0; nb < data.bubbles.length; nb++) {
            const b = data.bubbles[nb];
            if (b === null || b.x === null)
                continue;
            const b_new = new Bubble(b.x, b.y, b.r, b.color, b.text, b.fixed, b.weight, b.bounce, b.gravity, b.uuid, b.stick_to);
            add_bubble(b_new);
        }
        popped = data.popped;
    }
    function clear() {
        bubbles = []
        popped = [];
    }
    //
    function set_pan_zoom(px, py, z=0) {
        pan = [px, py];
        zoom = z || zoom;
        the_context.setTransform(zoom, 0, 0, zoom, pan[0], pan[1]);
    }
    /**
     * Click-and-hold adapter for buttons.  Calls first(), then repeatedly calls every() while clicked, then last().
     * @param button        Button to watch.
     * @param first         Called when clicked down.
     * @param every         Called while being held down.
     * @param last          Called when unclicked.
     * @param delay         Delay between calls while held down.
     */
    function button_hold_events(button, first, every, last, delay=250) {
        let t_click = null;
        let tmr_every = null;
        let running = false;
        function on_every() {
            if (! running)
                return;
            const t_now = new Date().getTime() - t_click;
            if (t_now > 15000)
                stop();
            every();
            tmr_every = setTimeout(on_every, delay);
        }
        function start() {
            running = true;
            t_click = new Date().getTime();
            if (every)
                tmr_every = setTimeout(on_every, delay);
            if (first)
                first();
        }
        function stop() {
            if (! running)
                return;
            running = false;
            clearTimeout(tmr_every);
            if (last)
                last();
        }
        button.addEventListener("mousedown", start);
        button.addEventListener("mouseup", stop);
        button.addEventListener("mouseout", stop);
        button.addEventListener("blur", stop);
    }
    /**
     * Do something every interval while button is clicked.
     */
    function button_repeater(button, fn, delay) {
        return button_hold_events(button, fn, fn, null, delay);
    }

    /**
     * Logarithmically adjust a value.
     */
    function edit_value(name, getter, setter, area, vmin, vmax) {
        const edit = document.createElement("input");
        edit.setAttribute("type", "number");
        function set_v(vw) {
            vw = Math.min(vw, vmax);
            vw = Math.max(vw, vmin);
            vw = Math.round(vw*100)/100;
            setter(vw);
            edit.value = vw.toFixed(2);
        }
        edit.addEventListener("change", function() {
            set_v(parseFloat(edit_weight.value));
        })
        set_v(getter());
        const btn_up = document.createElement("button");
        btn_up.innerText = "+"
        btn_up.addEventListener("click", function() {
            if (vmin <= 0)
                set_v(getter() + 1);
            else
                set_v(getter() * 1.2);
        });
        const btn_down = document.createElement("button");
        btn_down.innerText = "-"
        btn_down.addEventListener("click", function() {
            if (vmin <= 0)
                set_v(getter() - 1);
            else
                set_v(getter() / 1.2);
        });
        const lbl = document.createElement("span");
        lbl.innerText = name + ": ";
        area.appendChild(lbl);
        area.appendChild(btn_down);
        area.appendChild(edit);
        area.appendChild(btn_up);
    }

    /**
     * Choose color.
     */
    function choose_color(getter, setter, area) {
        const boxes = [];
        function upd(c) {
            setter(c);
            for (var n=0; n < boxes.length; n++) {
                if (boxes[n].getAttribute("data-color") === c) {
                    //boxes[n].style.borderColor = "black";
                    boxes[n].style.boxShadow = "#404040 0px 3px 0px";
                } else {
                    //boxes[n].style.borderColor = "rgba(0,0,0,0)";
                    boxes[n].style.boxShadow = "";
                }
            }
        }
        for (var n=0; n < r_colors.length; n++) {
            const box = document.createElement("span");
            box.innerText = "\u00a0";
            box.style.display = "inline-block";
            box.style.cursor = "pointer";
            box.style.width = "12px";
            box.style.height = "12px";
            //box.style.border = "solid 2px 2px 0 2px rgba(0,0,0,0)";
            box.style.backgroundColor = r_colors[n];
            box.setAttribute("data-color", r_colors[n]);
            box.addEventListener("click", function(evt){
                const c = evt.target.getAttribute("data-color");
                upd(c);
            });
            boxes.push(box);
            area.appendChild(box);
        }
        upd(getter());
    }
    function surface_tension(surface, fuzz) {
        let i = surface;
        let o = i;
        for (var n_fuzz=0; n_fuzz < fuzz; n_fuzz++) {
            o = []
            const ff = [[-2, 0.1], [-1, 0.25], [0, 0.3], [1, 0.25], [2, 0.1]];
            for (var n = 0; n < i.length; n++) {
                let v = 0;
                for (var nf = 0; nf < ff.length; nf++) {
                    const f0 = ff[nf][0];
                    const f1 = ff[nf][1];
                    v += i[(n + f0 + i.length) % i.length] * f1;
                }
                o.push(v);
            }
            i = o;
        }
        return o;
    }
    //
    class Bubble {
        constructor(x, y, r, color, text="", fixed=false, weight=1, bounce=1, gravity=0, uuid=null, stick_to=null) {
            this.x = x;
            this.y = y;
            this.vx = 0;
            this.vy = 0;
            if (r < min_bubble_r)
                r = min_bubble_r;
            this.r = r;
            this.r2 = r*r;
            this.uuid = uuid || crypto.randomUUID();
            this.stick_to = stick_to;
            this.color = color;
            this.text = text;
            this.weight = weight;
            this.bounce = bounce;
            this.fixed = fixed;
            this.gravity = gravity;
            this.created_at = new Date().getTime();
            this.popped_at = null;
            // view-related
            this.dragging = false;
            this.selected = false;
            this.squish = [];
            this.change_size = 0;
            this.popping = 0;
            this.restore_surface();
        }
        restore_surface() {
            const sq = []
            for (var n=0; n < 100; n++)
                sq.push(this.r);
            this.squish = sq;
        }
        poke(depth, angle, other_d, other_r) {
            const npts = this.squish.length;
            const to_n = 6.284 / npts;
            const ai = Math.round(angle / to_n);
            let c = other_r;
            let b = this.r;
            let a = other_d;
            let w_poke = Math.acos((a*a + b*b - c*c) / (2*a*b));
            if (isNaN(w_poke))
                // entirely inside
                return;
            const max_sq = this.r * 0.85;
            function f(a) {
                var wx = (a - angle)/w_poke;
                var da = Math.cos(1.57 * wx);
                if (da < 0)
                    da = 0
                var dd = da**0.25 * depth;
                return Math.min(dd, max_sq);
            }
            const nr = Math.floor(w_poke / to_n + 0.5);
            for (var n=ai-nr; n <= ai+nr; n ++) {
                const n1 = (n + npts) % npts;
                this.squish[n1] -= f(n * 6.284 / npts);
            }
        }
        draw(ctx) {
            const r = this.r - bubble_outer_margin;
            // indicator of bubble selection
            if ((capture_bubble_click  &&  capture_bubble_click.source === this) || (this.selected && this.stick_to)) {
                ctx.strokeStyle = "red";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                if (capture_bubble_click) {
                    const tx = move1[0] - move00[0];
                    const ty = move1[1] - move00[1];
                    ctx.lineTo(this.x + tx, this.y + ty);
                } else if (ltd_bubble_index[this.stick_to]) {
                    const tx = ltd_bubble_index[this.stick_to].x;
                    const ty = ltd_bubble_index[this.stick_to].y;
                    ctx.lineTo(tx, ty);
                }
                ctx.stroke();
            }
            // trace outline of bubble
            ctx.beginPath();
            if (this.squish) {
                // non-circular
                ctx.lineCap = "round";
                let npts = this.squish.length;
                let a = 0, da = 6.28318 / npts;
                for (var n=0; n < npts+1; n++) {
                    const x = this.x + (this.squish[n%npts] - bubble_outer_margin) * Math.cos(a);
                    const y = this.y + (this.squish[n%npts] - bubble_outer_margin) * Math.sin(a);
                    if (n === 0)
                        ctx.moveTo(x, y)
                    else
                        ctx.lineTo(x, y)
                    a += da;
                }
                if (this.selected)
                    ctx.closePath();
            } else {
                // circular
                ctx.ellipse(this.x, this.y, r - bubble_wall, r - bubble_wall, 0, 0, 6.284);
                ctx.closePath();
            }
            if (this.popping) {
                // no fill while popping
            }
            else if (this.selected) {
                // selected fill
                ctx.fillStyle = sel_color;
                ctx.globalAlpha = 0.7;
                ctx.fill()
                ctx.globalAlpha = 1;
            }
            else {
                // normal fill
                ctx.fillStyle = this.color;
                ctx.globalAlpha = 0.3;
                ctx.fill()
                ctx.globalAlpha = 1;
            }
            // draw border
            const w_h = bubble_wall * Math.max(0.1, Math.log(4*this.weight));
            ctx.lineWidth = w_h;
            if (this.popping)
                ctx.lineWidth = 1;
            ctx.strokeStyle = this.color;
            ctx.stroke();
            // pinned/fixed: show a dashed line inside the border
            if (this.fixed) {
                ctx.lineWidth = ctx.lineWidth / 3;
                ctx.strokeStyle = "white"
                ctx.setLineDash([4, 10])
                ctx.stroke();
                ctx.setLineDash([])
            }
            // pointer toward stuck-to bubble
            if (this.stick_to  &&  ltd_bubble_index[this.stick_to]) {
                const dx = ltd_bubble_index[this.stick_to].x - this.x;
                const dy = ltd_bubble_index[this.stick_to].y - this.y;
                const color = ltd_bubble_index[this.stick_to].color;
                let r = this.r;
                const a = Math.atan2(dy, dx)
                if (this.squish) {
                    let a_r = a * this.squish.length / 6.284;
                    a_r = Math.floor((a_r + this.squish.length) % this.squish.length);
                    r = this.squish[a_r];
                }
                const px = this.x + r * Math.cos(a);
                const py = this.y + r * Math.sin(a);
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(this.x + r*0.9*Math.cos(a-0.1), this.y + r*0.9*Math.sin(a-0.1));
                ctx.lineTo(this.x + r*0.9*Math.cos(a+0.1), this.y + r*0.9*Math.sin(a+0.1));
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
            }
            // text
            if (! this.popping) {
                ctx.textAlign = "center";
                ctx.fillStyle = this.selected ? 'black' : '#404040';
                let margin = 25;
                let draw_text = this.text;
                let lines = draw_text.trim().split("\n");
                let line_height = 16;
                ctx.font = line_height + "px sans-serif";
                const max_lines = Math.floor((2*this.r - margin) / line_height);
                if (lines.length > max_lines)
                    lines = lines.slice(0, max_lines);
                let by = line_height*lines.length/2 - line_height*0.8;
                for (var nl=0; nl < lines.length; nl++) {
                    let line = lines[nl];
                    let bw = Math.sqrt(this.r2 - by*by)*2 - margin;
                    let tw = ctx.measureText(line).width;
                    if (tw > bw) {
                        line = line.substring(0, Math.floor((bw-8) * line.length / tw)) + "\u2026";
                    }
                    ctx.fillText(line, this.x, this.y - by);
                    by -= line_height;
                }
            }
        }
        forces(dt) {
            let fx=0, fy=0;
            const a = this;
            this.restore_surface();
            if (this.popping)
                return [0, 0];
            ltd_bubble_index = {};
            for (var nb=0; nb < bubbles.length; nb++){
                const b = bubbles[nb];
                if (a === b  ||  b.popping)
                    continue;
                const dx = b.x - a.x, dy = b.y - a.y;
                const r2 = dx*dx + dy*dy;
                const ab_r2 = a.r2 + b.r2 + 2*a.r*b.r;
                const closeness = r2 - ab_r2;
                const d = Math.sqrt(dx*dx+dy*dy);
                let f_a = 0;
                if (closeness < 0) {
                    // bounciness
                    f_a = Math.sqrt(-closeness) * bounce * this.bounce * dt;
                    // show bounce visually
                    const poke_angle = Math.atan2(dy, dx);
                    let poke_depth = a.r + b.r - d;
                    poke_depth /= 2;
                    this.poke(poke_depth, poke_angle, d, b.r);
                } else if (closeness < 10000) {
                    // mild repulsion
                    f_a = repulsion * dt * 10 / (closeness + 10);
                }
                // stuck to another bubble - follow closely
                if (b.uuid === this.stick_to) {
                    ltd_bubble_index[b.uuid] = b;
                    if (closeness > 200)
                        f_a = -((closeness - 200)/200) * dt;
                }
                // gravity toward other bubble
                else if (b.gravity) {
                    const grav = b.gravity || 11;
                    // if the target is not pinned we have to stop pushing or we'll just push the target around
                    if (! b.fixed && closeness < 1000) {
                        // inhibit gravity when very close if target is unpinned - otherwise it will get pushed around
                    }
                    else
                        f_a += -grav * 5 * dt * 0.5**((d-b.r)/500) * Math.sqrt(this.weight);
                }
                if (f_a) {
                    fx -= f_a * dx/d;
                    fy -= f_a * dy/d;
                }
            }
            this.squish = surface_tension(this.squish, 3);
            if (this.dragging  ||  this.fixed  ||  this.popping)
                return [0, 0];
            // toward center
            const d0 = Math.sqrt(a.x*a.x + a.y*a.y);
            if (to_center && d0 > 30) {
                const f0c = dt * to_center * this.weight;
                fx -= f0c * a.x/d0;
                fy -= f0c * a.y/d0;
            }
            if (Math.abs(fx) < bg_friction)
                fx = 0;
            if (Math.abs(fy) < bg_friction)
                fy = 0;
            return [fx, fy];
        }
        move(dt, friction) {
            const force = this.forces(dt);
            this.vx += force[0];
            this.vy += force[1];
            this.x += this.vx * inertia;
            this.y += this.vy * inertia;
            this.vx *= friction;
            this.vy *= friction;
            if (this.change_size) {
                let amt = 0;
                if (Math.abs(this.change_size) < 1)
                    amt = this.change_size;
                else
                    amt = dt * 0.8 * this.change_size;
                this.r += amt;
                if (this.r < min_bubble_r)
                    this.r = min_bubble_r;
                this.r2 = this.r ** 2;
                this.change_size -= amt;
            }
            if (this.popping) {
                console.log("popping")
                const expand = 0.3 ** dt;
                this.r *= expand;
                this.r2 = this.r ** 2;
                this.popping *= expand;
                if (this.popping < 0.1) {
                    const bbl = delete_bubble(this);
                    bbl.popped_at = new Date().getTime();
                    if (save_popped)
                        popped.push(bbl);
                }
            }
        }
    }
    function draw_grid() {
        const ctx = the_context;
        let x0 = -pan[0]/zoom;
        let y0 = -pan[1]/zoom;
        const grid_size = 100;
        const w = the_canvas.width / zoom;
        const h = the_canvas.height / zoom;
        const n_x = Math.floor(w / grid_size) + 1;
        const n_y = Math.floor(h / grid_size) + 1;
        const gx0 = x0 - x0 % grid_size;
        const gy0 = y0 - y0 % grid_size;
        ctx.fillStyle = grid_color;
        for (let ny=0; ny < n_y; ny++)
            ctx.fillRect(x0, gy0 + ny*grid_size, w, 1);
        for (let nx=0; nx < n_x; nx++)
            ctx.fillRect(gx0 + nx*grid_size, y0, 1, h);
    }
    function frame() {
        const ctx = the_context;
        const z = zoom;
        //ctx.clearRect(-the_canvas.width/2, -the_canvas.height/2, the_canvas.width, the_canvas.height)
        ctx.fillStyle = bg_color;
        ctx.fillRect(-pan[0]/z, -pan[1]/z, the_canvas.width/z, the_canvas.height/z)
        const t = new Date().getTime();
        const dt = Math.min(t - t0, 0.1);
        const friction = v_friction**dt;
        if (show_grid)
            draw_grid();
        t0 = t;
        for (var nb=0; nb < bubbles.length; nb++){
            bubbles[nb].move(dt, friction);
            bubbles[nb].draw(ctx);
        }
    }
    function overbubble(x, y) {
        let best = null;
        let d_best = null;
        for (var nb=0; nb < bubbles.length; nb++) {
            const b = bubbles[nb];
            const d2 = (x-b.x)*(x-b.x)+(y-b.y)*(y-b.y);
            if (d2 < b.r2) {
                if (b.squish) {
                    let clk_a = Math.atan2(y - b.y, x - b.x) * b.squish.length / 6.284;
                    clk_a = Math.floor((clk_a + b.squish.length) % b.squish.length);
                    const clk_r = b.squish[clk_a];
                    if (d2 < clk_r*clk_r  &&  (! best || d2 < d_best)) {
                        best = b;
                        d_best = d2;
                    }
                }
            }
        }
        return best;
    }
    function draw_bubble_form(bubble, area) {
        function refresh() {
            if (! bubble.selected)
                return;
            var h = "";
            h += "<div class='title'>Edit Bubble Data</div>";
            area.innerHTML = h;
            // edit title
            const edit_text = document.createElement("textarea");
            edit_text.setAttribute("rows", "3");
            edit_text.value = bubble.text;
            edit_text.addEventListener("input", function() {
                bubble.text = edit_text.value;
            })
            area.appendChild(edit_text);
            area.appendChild(document.createElement("br"));
            // color
            choose_color(function(){ return bubble.color; }, function(c){ bubble.color = c; }, area);
            area.appendChild(document.createElement("br"));
            // bigger/smaller/puff up
            const btn_smaller = document.createElement("button");
            btn_smaller.innerText = "smaller"
            button_repeater(btn_smaller, function(){
                bubble.change_size -= bubble.r * 0.15;
            }, 500);
            area.appendChild(btn_smaller);
            // - bigger
            const btn_bigger = document.createElement("button");
            btn_bigger.innerText = "bigger"
            button_repeater(btn_bigger, function(){
                bubble.change_size += bubble.r * 0.15;
            }, 500);
            area.appendChild(btn_bigger);
            // - puff
            const btn_puff = document.createElement("button");
            btn_puff.innerText = "puff"
            var save_r = null;
            button_hold_events(btn_puff,
                function(){
                    save_r = bubble.r;
                }, function(d){
                    bubble.r *= 1.025;
                    bubble.r2 = bubble.r ** 2;
                }, function(d){
                    function down(){
                        bubble.r /= 1.025;
                        if (bubble.r > save_r)
                            setTimeout(down, 50);
                        else
                            bubble.r = save_r;
                        bubble.r2 = bubble.r ** 2;
                    }
                    setTimeout(down, 50);
                },
                50);
            area.appendChild(btn_puff);
            area.appendChild(document.createElement("br"));
            // weight
            edit_value("weight", function(){ return bubble.weight; }, function(v){ bubble.weight = v; }, area, 0.1, 10.0);
            area.appendChild(document.createElement("br"));
            // gravity
            edit_value("gravity",function(){ return bubble.gravity; }, function(v){ bubble.gravity = v; }, area, 0, 20);
            area.appendChild(document.createElement("br"));
            // pinned
            const btn_pinned = document.createElement("button");
            btn_pinned.innerText = bubble.fixed ? "PINNED" : "   pin   ";
            btn_pinned.addEventListener("click", function() {
                bubble.fixed = ! bubble.fixed;
                btn_pinned.innerText = bubble.fixed ? "PINNED" : "   pin   ";
            });
            area.appendChild(btn_pinned);
            // stick-to
            const btn_stick = document.createElement("button");
            btn_stick.innerText = bubble.stick_to ? "unstick" : "stick-to";
            btn_stick.addEventListener("click", function() {
                if (bubble.stick_to)
                    bubble.stick_to = null;
                else {
                    // let user click on a bubble
                    capture_bubble_click = {
                        mode: "stick-to",
                        source: bubble,
                        selected: function(to_bubble) {
                            if (to_bubble) {
                                bubble.stick_to = to_bubble.uuid;
                            }
                        }
                    }
                }
                btn_stick.innerText = bubble.stick_to ? "unstick" : "stick-to";
            });
            area.appendChild(btn_stick);
            // pop bubble
            const btn_pop = document.createElement("button");
            btn_pop.innerText = "pop"
            btn_pop.addEventListener("click", function() {
                bubble.popping = 1;
                bubble.restore_surface();
            });
            area.appendChild(btn_pop);
            //
            if (bubble.selected) {
                setTimeout(refresh, 60000);
            }
        }
        refresh();
    }
    function drag_and_select() {
        const canvas = the_canvas
        var onbubble = null;
        var start = null;
        var pan0 = null;
        var clicked = false;
        var panel = document.getElementById("panel");
        // set up tools
        function change_zoom(by, steps) {
            const w = canvas.width/2;
            const h = canvas.height/2;
            let r = Math.exp(Math.log(by)/steps);
            function change(){
                console.log(r);
                set_pan_zoom((pan[0] - w)/r + w, (pan[1] - h)/r + h, zoom*r);
                if (steps > 0) {
                    setTimeout(change, frame_rate);
                    steps -= 1;
                }
            }
            change();
        }
        document.getElementById("zoom-in").addEventListener("click", function(){
            change_zoom(1.25, 12)
        });
        document.getElementById("zoom-out").addEventListener("click", function(){
            change_zoom(1/1.25, 12);
        });
        const edt_title = document.getElementById("title");
        const save_sel = document.getElementById("saves");
        function title_change() {
            // title changed
            const edited = edt_title.value || "default";
            if (edited === title)
                return;
            if (edited === "") {
                edt_title.value = title;
                return;
            }
            const saves = all_saves();
            if (saves.indexOf(edited) >= 0) {
                // warn on overwrite
                if (! confirm("Are you sure you want to replace '" + edited + "'?"))
                    return;
            }
            // change title, rename saved data
            title = edited;
            let n = saves.indexOf(title);
            if (n >= 0)
                saves.splice(n, 1);
            saves.push(edited);
            upd_saves(saves);
            // save right away
            save(title);
            // select in drop-down
            save_sel.value = title;
            // bookmarkable
            window.location.hash = title;
        }
        edt_title.addEventListener("keydown", function(evt) {
            if (evt.code === "Enter") {
                edt_title.blur();
            }
        });
        // rename on Enter/blur of title editor
        edt_title.addEventListener("blur", title_change);
        // detect hash change from browser back/fwd buttons
        window.addEventListener("hashchange", function(){
            save();
            clear();
            setup();
        });
        // switch
        save_sel.addEventListener("change", function(){
            if (save_sel.value === "")
                return;
            save(title);
            load(save_sel.value);
            // bookmarkable
            window.location.hash = title;
        });
        // 'new'
        const btn_new = document.getElementById("new-file");
        btn_new.addEventListener("click", function(){
            // save current data
            save(title);
            const new_title = prompt("Name for new thing: ");
            if (new_title === "")
                return;
            clear();
            title = new_title;
            save(title);
            load(title);
            // bookmarkable
            window.location.hash = title;
        });
        // 'delete'
        const btn_del = document.getElementById("delete-file");
        btn_del.addEventListener("click", function(){
            clear();
            let saves = all_saves();
            saves.splice(saves.indexOf(title), 1);
            upd_saves(saves);
            // return to default
            load();
            window.location.hash = title;
        });
        // 'grid'
        const btn_grid = document.getElementById("show-grid");
        btn_grid.addEventListener("click", function(){
            show_grid = ! show_grid;
        });
        //
        function to_ctx_coords(evt) {
            return [(evt.offsetX - pan[0])/zoom, (evt.offsetY - pan[1])/zoom];
        }
        function select_bubble(bubble) {
            const select = bubble && ! bubble.selected;
            // deselect all bubbles
            for (var nb=0; nb < bubbles.length; nb++)
                bubbles[nb].selected = false;
            if (bubble && select) {
                // select bubble
                bubble.selected = true;
                draw_bubble_form(bubble, panel);
                panel.style.display = 'block';
            } else {
                panel.innerText = "";
                panel.style.display = 'none';
            }
        }
        function create_bubble(at) {
            const c = r_colors[Math.floor(Math.random()*r_colors.length)];
            const bubble = new Bubble(at[0], at[1], 50, c);
            add_bubble(bubble);
            select_bubble(bubble);
        }
        canvas.addEventListener("dblclick", function(evt) {
            create_bubble(to_ctx_coords(evt));
        });
        canvas.addEventListener("mousedown", function(evt){
            const pos = to_ctx_coords(evt);
            clicked = true;
            onbubble = overbubble(pos[0], pos[1]);
            if (capture_bubble_click) {
                // delegate the bubble click
                capture_bubble_click.selected(onbubble);
                capture_bubble_click = null;
            } else {
                select_bubble(onbubble);
            }
            if (onbubble) {
                onbubble.dragging = true;
                onbubble.vx = 0;
                onbubble.vy = 0;
                start = [pos[0] - onbubble.x, pos[1] - onbubble.y];
            }
            move00 = [evt.x, evt.y, new Date().getTime()]
            move0 = move1 = null;
            pan0 = [pan[0], pan[1]];
        });
        canvas.addEventListener("mouseup", function(){
            clicked = false;
            if (onbubble) {
                onbubble.dragging = false;
                // 'throw' it
                if (move0 && move1) {
                    const dx = move1[0] - move0[0];
                    const dy = move1[1] - move0[1];
                    const dt = move1[2] - move0[2];
                    const w_factor = 2 * onbubble.weight**0.1;
                    onbubble.vx += 20*dx*w_factor / dt;
                    onbubble.vy += 20*dy*w_factor / dt;
                }
            }
            onbubble = null;
        });
        canvas.addEventListener("mousemove", function(evt){
            const pos = to_ctx_coords(evt);
            const move = [evt.x, evt.y, new Date().getTime()]
            move0 = move1;
            move1 = move;
            if (onbubble) {
                // drag
                onbubble.x = pos[0] - start[0];
                onbubble.y = pos[1] - start[1];
            } else if (clicked) {
                // pan
                const dx = move[0] - move00[0];
                const dy = move[1] - move00[1];
                const z = zoom;
                set_pan_zoom(pan0[0] + dx*z, pan0[1] + dy*z);
            }
        });
    }
    function show_popped() {
        const area = document.getElementById("data-frame");
        // display area
        // populate the table
        // button to un-pop or permanently delete
        // close button
    }
    function add_random_bubble() {
        var px = Math.random()*900 - 450;
        var py = Math.random()*900 - 450;
        var r = Math.random()*80 + 20;
        var c = r_colors[Math.floor(Math.random()*r_colors.length)];
        add_bubble(new Bubble(px, py, r, c, ''));
    }
    function setup() {
        let mode = window.location.hash;
        if (mode.startsWith("#"))
            mode = mode.substring(1);
        mode = decodeURI(mode);
        const canvas = document.getElementById("view");
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        the_canvas = canvas;
        the_context = canvas.getContext('2d');
        set_pan_zoom(canvas.width/2, canvas.height/2, 1);
        // start bubble animations
        setInterval(function(){ frame(); }, frame_rate);
        if (mode === "_demo_") {
            add_bubble(new Bubble(0, 0, 140, 'blue', 'bubbles!', true));
            save_popped = false;
            for (var nb=0; nb < 25; nb++)
                add_random_bubble();
            function updates() {
                if (Math.random() < 0.1 && bubbles.length < 40)
                    add_random_bubble();
                if (Math.random() < 0.1 && bubbles.length > 10) {
                    nb = Math.floor(Math.random()*(bubbles.length - 1)) + 1;
                    bubbles[nb].popping = 1;
                }
            }
            setInterval(updates, 150);
        } else {
            upd_saves();
            save_popped = true;
            load(mode);
            // auto-save
            setInterval(function(){save(title);}, 5000);
            // introductory bubble
            if (! bubbles.length)
                add_bubble(new Bubble(0, 0, 140, 'blue', 'double click to add a bubble\nclick to change or drag', true, 1, 1, 5));
            // make bubbles draggable
            drag_and_select();
        }
    }
    window.addEventListener("load", setup);
})();

/*
 TODO...

 pop bubble - others might be stuck to it

 deletion needs a warning, and needs testing - clicking it a few times will delete random entries

 it has frozen up a couple times and you can't select anything

 view popped bubbles as table, delete to trash
   see show_popped()

 energy is leaking into the system, causing bubbles to spin instead of settle down (not enough entropy somewhere)

 option to show off-screen bubbles (thin arrows around the edge of the page, possibly with labels)

 stick-to button needs to say 'now click on a bubble'
 stick-to button should say which button it's stuck to (stuck to: ____)

 bubbles are still being chased (some were running away)
 better selection graphic, like bouncing arrows, so you can see the proper bg color
 drag should not select (?)
 hover to see details

 ground-down mode, or place a boundary
 JIRA link per bubble
 coordinates

 instructions
   double click to create new bubble
   link to demo mode

 */