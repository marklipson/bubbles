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
    let max_bubble_r = 2000;
    // show grid
    let show_grid = true;
    // available colors
    const r_colors = [
        "black", "gray",
        "red", "crimson", "deeppink", "maroon",
        "orange", "darkorange", "goldenrod", "brown",
        "yellow", "gold",
        "greenyellow",
        "green", "limegreen",
        "darkolivegreen", "darkseagreen",
        "darkturquoise",
        "darkcyan",
        "aqua",
        "blue", "cornflowerblue",
        "royalblue", "darkslateblue", "slateblue",
        "purple", "darkviolet"
    ];
    /////////
    // colors
    let sel_color = "rgba(255,255,128,128)";  // "#ffff80";
    let bg_color = "#e0e0e0";
    let grid_color = "#c0c0ff";
    let space_color = "#80a0c0";
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
    let world_r = 6000;
    let pan = [0, 0];
    let zoom = 1;
    var mouse_pos = [0, 0];
    var move00 = null, move0 = null, move1 = null;
    let the_canvas = null;
    let the_context = null;
    let capture_bubble_click = null;
    let bubble_index = {};
    let animators = [];
    function add_bubble(bubble) {
        bubbles.push(bubble);
        bubble_index[bubble.uuid] = bubble;
    }
    function stick_bubbles(source, target) {
        source.stick_to = target.uuid;
        target.refs.push(source.uuid);
    }
    function delete_bubble(bubble) {
        for (let nr=0; nr < bubble.refs; nr++) {
            let other = bubble_index[bubble.refs[nr]];
            if (other && other.stick_to === bubble.uuid)
                other.stick_to = null;
        }
        const nb = bubbles.indexOf(bubble);
        delete bubble_index[bubble.uuid];
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
        name = name || title || "default";
        const all = all_saves();
        const data = JSON.stringify({"bubbles": bubbles, "popped": popped, "pan": pan, "zoom": zoom});
        localStorage.setItem("save." + name, data);
        // make sure the save is listed
        if (all.indexOf(name) < 0) {
            all.push(name);
            upd_saves(all);
        }
    }
    function clear() {
        bubbles = []
        bubble_index = {}
    }
    function load(name="") {
        name = name || "default";
        if (name === title)
            return;
        title = name;
        const edt_title = document.getElementById("title");
        edt_title.value = name;
        let data = JSON.parse(localStorage.getItem("save." + name));
        if (data === null)
            data = {bubbles: [], popped: []};
        clear();
        let refs = [];
        for (let nb=0; nb < data.bubbles.length; nb++) {
            const b = data.bubbles[nb];
            if (b === null || b.x === null)
                continue;
            const b_new = new Bubble(b.x, b.y, b.r, b.color, b.text, b.fixed, b.weight, b.bounce, b.gravity, b.uuid, b.stick_to);
            add_bubble(b_new);
            if (b.stick_to)
                refs.push([b.uuid, b.stick_to]);
        }
        for (let nr=0; nr < refs.length; nr++) {
            const ref = refs[nr]
            const referenced = bubble_index[ref[1]];
            if (referenced)
                referenced.refs.push(ref[0]);
        }
        popped = data.popped;
        if (data.pan && data.zoom)
            set_pan_zoom(data.pan[0], data.pan[1], data.zoom);
        // make it bookmarkable
        window.location.hash = title;
    }
    //
    function make_uuid() {
        if (typeof(crypto) != "undefined"  &&  typeof(crypto.randomUUID) != "undefined")
            return crypto.randomUUID();
        return Math.floor(Math.random()*2000000000).toString(36);
    }
    //
    function set_pan_zoom(px, py, z=0) {
        const trunc = truncate_to_world(px, py);
        px = trunc[0];
        py = trunc[1];
        const w = the_canvas.width;
        const h = the_canvas.height;
        pan = [px, py];
        zoom = z || zoom;
        const tx = w/2 - zoom*px;
        const ty = h/2 - zoom*py;
        the_context.setTransform(zoom, 0, 0, zoom, tx, ty);
    }
    //
    function truncate_to_world(px, py, margin=0) {
        const d2 = px*px + py*py;
        const r = world_r - margin;
        if (d2 < r*r)
            return [px, py];
        const f = r / Math.sqrt(d2);
        return [px * f, py * f];
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
        btn_up.setAttribute("title", "Increase " + name);
        btn_up.innerText = "+"
        btn_up.addEventListener("click", function() {
            if (vmin <= 0)
                set_v(getter() + 1);
            else
                set_v(getter() * 1.2);
        });
        const btn_down = document.createElement("button");
        btn_down.setAttribute("title", "Decrease " + name);
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
            box.style.width = "16px";
            box.style.height = "16px";
            box.style.marginBottom = "6px";
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
            this.uuid = uuid || make_uuid();
            this.stick_to = stick_to;
            this.refs = [];
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
        radius(px, py) {
            let r = this.r;
            const a = Math.atan2(py - this.y, px - this.x)
            if (this.squish) {
                let a_r = a * this.squish.length / 6.284;
                a_r = Math.floor((a_r + this.squish.length) % this.squish.length);
                r = this.squish[a_r];
            }
            return r;
        }
        polar(a, r) {
            return [
                this.x + Math.cos(a) * r,
                this.y + Math.sin(a) * r
            ];
        }
        wall_width() {
            return bubble_wall * Math.max(0.1, Math.log(4*this.weight));
        }
        draw(ctx) {
            const r = this.r - bubble_outer_margin;
            // indicator of bubble selection
            if ((capture_bubble_click  &&  capture_bubble_click.source === this) || (bubble_index[this.stick_to])) {
                ctx.lineWidth = 2;
                ctx.beginPath();
                let x0 = this.x, y0 = this.y;
                let x1 = 0, y1 = 0;
                if (capture_bubble_click) {
                    x1 = this.x + move1[0] - move00[0];
                    y1 = this.y + move1[1] - move00[1];
                    ctx.strokeStyle = "red";
                } else if (bubble_index[this.stick_to]) {
                    const other = bubble_index[this.stick_to];
                    x1 = other.x;
                    y1 = other.y;
                    // move (x1, y1) to the edge of the other bubble
                    let r_d = other.radius(x0, y0) / Math.sqrt((x1-x0)**2 + (y1-y0)**2);
                    x1 -= (x1-x0)*r_d;
                    y1 -= (y1-y0)*r_d;
                    ctx.strokeStyle = "darkgray";
                }
                // move (x0, y0) to the edge of this bubble
                let r_d = this.radius(x1, y1) / Math.sqrt((x1-x0)**2 + (y1-y0)**2);
                x0 += (x1-x0)*r_d;
                y0 += (y1-y0)*r_d;
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
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
            // normal fill
            if (! this.popping) {
                ctx.fillStyle = this.color;
                ctx.globalAlpha = 0.3;
                ctx.fill()
                ctx.globalAlpha = 1;
            }
            // draw border
            ctx.lineWidth = this.wall_width();
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
            if (this.selected && ! this.popping) {
                // show selection
                const dt = new Date();
                const t = (dt.getUTCSeconds() * 1000 + dt.getUTCMilliseconds()) / 1000;
                const xr = Math.sin((t % 2.0)/(2.0/6.283)) * 5;
                const spin = (t % 1000000)/10;
                ctx.fillStyle = sel_color;
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.lineWidth = 10/zoom;
                ctx.strokeStyle = sel_color;
                ctx.arc(this.x, this.y, (50 + xr)/zoom, 0, 6.283);
                ctx.stroke()
                ctx.globalAlpha = 1;
                /*
                // crosshairs
                ctx.beginPath();
                ctx.strokeStyle = "red";
                ctx.lineWidth = 4 / zoom;
                for (let a=0; a < 6.283; a += 1.5707) {
                    ctx.beginPath();
                    let p1 = this.polar(a, (25 + xr)/zoom);
                    let p2 = this.polar(a, (50 + xr)/zoom);
                    ctx.moveTo(p1[0], p1[1]);
                    ctx.lineTo(p2[0], p2[1]);
                    ctx.stroke();
                }
                */
                ctx.strokeStyle = "gray";
                ctx.lineWidth = 1 / zoom;
                for (let a=0; a < 6.283; a += 0.15707) {
                    ctx.beginPath();
                    let p1 = this.polar(a+spin, (60)/zoom);
                    let p2 = this.polar(a+spin, (67)/zoom);
                    ctx.moveTo(p1[0], p1[1]);
                    ctx.lineTo(p2[0], p2[1]);
                    ctx.stroke();
                }
            }
            // pointer toward stuck-to bubble
            if (this.stick_to  &&  bubble_index[this.stick_to]) {
                const color = bubble_index[this.stick_to].color;
                const to_x = bubble_index[this.stick_to].x;
                const to_y = bubble_index[this.stick_to].y;
                let r = this.radius(to_x, to_y);
                let a = Math.atan2(to_y - this.y, to_x - this.x);
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
                    if (closeness > 200)
                        f_a = -((closeness - 200)/200) * 2 * dt;
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
                // give the force (f_a) a direction
                if (f_a && d) {
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
            // the 'paper' prevents any force below a certain level
            // TODO combine fx+fy properly into a vector and use its length - the calculation below is 'square'
            if (Math.abs(fx) < bg_friction  &&  Math.abs(fy) < bg_friction) {
                fx = 0;
                fy = 0;
            }
            return [fx, fy];
        }
        move(dt, friction) {
            let force = this.forces(dt);
            if (! isFinite(force[0]) || ! isFinite(force[1])) {
                console.log("FORCE is " + force[0] + ", " + force[1])
                force = [0, 0]
            }
            if (isNaN(force[0]) || isNaN(force[1]))
                force = [0, 0];
            this.vx += force[0];
            this.vy += force[1];
            // force is reduced a little
            //  - this is a bit of a hack to make sure entropy is reasonably close to something physical
            //  - if we keep adding energy into the system it will explode, or at least wiggle, under certain circumstances
            this.x += this.vx * inertia;
            this.y += this.vy * inertia;
            const trunc = truncate_to_world(this.x, this.y, this.r + 10);
            this.x = trunc[0];
            this.y = trunc[1];
            // this kind of friction is a bit like moving through a viscous fluid (closer to 0) or a gas (closer to 1)
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
                if (this.r > max_bubble_r)
                    this.r = max_bubble_r;
                this.r2 = this.r ** 2;
                this.change_size -= amt;
            }
            if (this.popping) {
                const expand = 0.3 ** dt;
                this.r *= expand;
                this.r2 = this.r ** 2;
                this.popping *= expand;
            }
        }
    }
    function draw_grid() {
        const ctx = the_context;
        const w = the_canvas.width / zoom;
        const h = the_canvas.height / zoom;
        let x0 = pan[0] - w/2;
        let y0 = pan[1] - h/2;
        const grid_size = 100;
        const n_x = Math.floor(w / grid_size) + 1;
        const n_y = Math.floor(h / grid_size) + 1;
        const gx0 = x0 - x0 % grid_size;
        const gy0 = y0 - y0 % grid_size;
        ctx.fillStyle = grid_color;
        for (let ny=0; ny < n_y; ny++)
            ctx.fillRect(x0, gy0 + ny*grid_size, w, 1);
        for (let nx=0; nx < n_x; nx++)
            ctx.fillRect(gx0 + nx*grid_size, y0, 1, h);
        // DEBUG
        ctx.fillStyle = "darkgray";
        ctx.fillRect(-100, -1, 200, 3);
        ctx.fillRect(-1, -100, 3, 200);
        //ctx.fillText("PAN=" + pan[0] + ", " + pan[1], pan[0], pan[1])
    }
    function pop_bubble(bubble) {
        const ctx = the_context;
        let parts = [];
        const squishlen = bubble.squish.length;
        const avglen = 6.283 * bubble.r * 5 / squishlen;
        bubble.popped_at = new Date().getTime();
        bubble.popping = 1;
        if (save_popped)
            popped.push(bubble);
        for (let nr=0; nr < squishlen; nr+=5) {
            const a = nr*6.283/squishlen;
            const c = bubble.polar(a, bubble.squish[nr]);
            parts.push({x: c[0], y: c[1], a: a + 1.57, vx: 12*Math.cos(a) + 5*Math.random(), vy: 12*Math.sin(a) + 5*Math.random(), da: Math.random()-0.5, len: avglen + Math.random()*avglen*0.7})
        }
        let n_frames = 20;
        let frame = 0;
        function pop_frame(dt) {
            ctx.beginPath();
            ctx.lineWidth = bubble.wall_width();
            ctx.strokeStyle = bubble.color;
            for (let np=0; np < parts.length; np++) {
                const part = parts[np];
                const dx = Math.cos(part.a) * part.len;
                const dy = Math.sin(part.a) * part.len;
                ctx.moveTo(part.x+dx, part.y+dy);
                ctx.lineTo(part.x-dy, part.y-dy);
                part.x += part.vx;
                part.y += part.vy;
                part.a += part.da;
            }
            ctx.globalAlpha = ((n_frames-frame)/n_frames);
            ctx.stroke();
            ctx.globalAlpha = 1
            frame ++;
            if (frame >= n_frames) {
                delete_bubble(bubble);
                return true;
            }
            return false;
        }
        animators.push(pop_frame);
    }
    function frame() {
        const ctx = the_context;
        const z = zoom;
        //ctx.clearRect(-the_canvas.width/2, -the_canvas.height/2, the_canvas.width, the_canvas.height)
        const sw = the_canvas.width;
        const sh = the_canvas.height;
        // fill visible black
        ctx.fillStyle = space_color;
        ctx.fillRect(pan[0] - sw/2/z, pan[1] - sh/2/z, sw/z, sh/z)
        // draw world color and grid inside the giant circle
        ctx.save()
        ctx.beginPath();
        ctx.ellipse(0, 0, world_r, world_r, 0, 0, 6.28319);
        ctx.clip();
        ctx.fillStyle = bg_color;
        ctx.fillRect(pan[0] - sw/2/z, pan[1] - sh/2/z, sw/z, sh/z)
        if (show_grid)
            draw_grid();
        ctx.restore();
        // move & draw bubbles
        const t = new Date().getTime();
        const dt = Math.min(t - t0, 0.1);
        const friction = v_friction**dt;
        t0 = t;
        for (var nb=0; nb < bubbles.length; nb++){
            bubbles[nb].move(dt, friction);
            bubbles[nb].draw(ctx);
        }
        // additional animations
        let remove_anims = [];
        for (let na=0; na < animators.length; na++) {
            let anim = animators[na];
            // call each animator - they return true when they are done
            if (anim(dt))
                remove_anims.push(anim)
        }
        for (na=0; na < remove_anims.length; na++) {
            animators.splice(animators.indexOf(remove_anims[na]), 1);
        }
    }
    function overbubble(x, y) {
        let best = null;
        let d_best = null;
        for (var nb=0; nb < bubbles.length; nb++) {
            const b = bubbles[nb];
            const d2 = (x-b.x)*(x-b.x)+(y-b.y)*(y-b.y);
            if (d2 < b.r2) {
                const clk_r = b.radius(x, y)
                if (d2 < clk_r*clk_r  &&  (! best || d2 < d_best)) {
                    best = b;
                    d_best = d2;
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
            h += "<div class='title'>Edit Bubble</div>";
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
            btn_puff.setAttribute("title", "Pump up with extra air while clicking, then release when unclicked.");
            btn_puff.innerText = "puff"
            var save_r = null;
            button_hold_events(btn_puff,
                function(){
                    save_r = bubble.r;
                }, function(d){
                    bubble.r *= 1.025;
                    if (bubble.r > max_bubble_r)
                        bubble.r = max_bubble_r;
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
            btn_pinned.setAttribute("title", "When a bubble is 'pinned' it cannot be moved by other bubbles.");
            btn_pinned.innerText = bubble.fixed ? "PINNED" : "   pin   ";
            btn_pinned.addEventListener("click", function() {
                bubble.fixed = ! bubble.fixed;
                btn_pinned.innerText = bubble.fixed ? "PINNED" : "   pin   ";
            });
            area.appendChild(btn_pinned);
            // stick-to
            const btn_stick = document.createElement("button");
            btn_stick.setAttribute("title", "Attaches a stretchy line to another bubble.");
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
                                stick_bubbles(bubble, to_bubble);
                            }
                        }
                    }
                }
                btn_stick.innerText = bubble.stick_to ? "unstick" : "stick-to";
            });
            area.appendChild(btn_stick);
            // pop bubble
            const btn_pop = document.createElement("button");
            btn_pop.setAttribute("title", "Pop a bubble.  Goodbye, bubble.");
            btn_pop.innerText = "pop"
            btn_pop.addEventListener("click", function() {
                pop_bubble(bubble);
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
            if (zoom < 0.125 && by < 1)
                return;
            if (zoom > 8 &&  by > 1)
                return;
            let r = Math.exp(Math.log(by)/steps);
            function change(){
                set_pan_zoom(pan[0], pan[1], zoom*r);
                if (steps > 0) {
                    setTimeout(change, frame_rate);
                    steps -= 1;
                }
            }
            change();
        }
        button_repeater(document.getElementById("zoom-in"), function() { change_zoom(1.25, 6)}, 240)
        button_repeater(document.getElementById("zoom-out"), function() { change_zoom(1/1.25, 6)}, 240)
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
            save();
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
            let mode = window.location.hash;
            if (mode.startsWith("#"))
                mode = mode.substring(1);
            mode = decodeURI(mode);
            load(mode);
        });
        // switch
        save_sel.addEventListener("change", function(){
            if (save_sel.value === "")
                return;
            save();
            load(save_sel.value);
        });
        // 'new'
        const btn_new = document.getElementById("new-file");
        btn_new.addEventListener("click", function(){
            // save current data
            save();
            const new_title = prompt("Name for new thing: ");
            if (new_title === "")
                return;
            clear();
            set_pan_zoom(0, 0, 1);
            title = new_title;
            save(tite);
            load(title);
        });
        // 'delete'
        const btn_del = document.getElementById("delete-file");
        btn_del.addEventListener("click", function(){
            if (! confirm("Are you sure you want to delete the bubble world '" + title + "'?  Click CANCEL to keep it."))
                return;
            clear();
            let saves = all_saves();
            saves.splice(saves.indexOf(title), 1);
            upd_saves(saves);
            // return to default
            load();
        });
        // 'grid'
        const btn_grid = document.getElementById("show-grid");
        btn_grid.addEventListener("click", function(){
            show_grid = ! show_grid;
        });
        //
        function to_ctx_coords(evt) {
            const w = the_canvas.width;
            const h = the_canvas.height;
            return [(evt.offsetX - w/2)/zoom + pan[0], (evt.offsetY - h/2)/zoom + pan[1]];
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
        canvas.addEventListener("mouseout", function(){
            // TODO if the mouse leaves it may never return, but it still could keep moving, possibly?
            clicked = false;
            if (onbubble) {
                onbubble.dragging = false;
                onbubble = null;
            }
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
                    const w_factor = 40 * onbubble.weight**0.1 / dt;
                    if (isFinite(dx)  &&  isFinite(dy) && isFinite(w_factor)) {
                        onbubble.vx += dx * w_factor;
                        onbubble.vy += dy * w_factor;
                    }
                }
            }
            onbubble = null;
        });
        canvas.addEventListener("mousemove", function(evt){
            const pos = to_ctx_coords(evt);
            mouse_pos = pos
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
                set_pan_zoom(pan0[0] - dx/zoom, pan0[1] - dy/zoom);
            }
        });
        // TODO I saw something on fredmeyer.com using two-finger scroll so it must be possible
        //   - but this isn't working
        //canvas.addEventListener("touchmove", function(evt) {
        //    console.log(evt);
        //});
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
        // FIXME update this on resize!
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        the_canvas = canvas;
        the_context = canvas.getContext('2d');
        set_pan_zoom(pan[0], pan[1], zoom);
        // start bubble animations
        setInterval(function(){ frame(); }, frame_rate);
        // make bubbles draggable
        drag_and_select();
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
                    pop_bubble(bubbles[nb]);
                }
            }
            setInterval(updates, 150);
        } else {
            upd_saves();
            save_popped = true;
            load(mode);
            // auto-save
            setInterval(function(){save();}, 5000);
            // introductory bubble
            if (! bubbles.length)
                add_bubble(new Bubble(0, 0, 140, 'blue', 'double click to add a bubble\nclick to change or drag', true, 1, 1, 5));
        }
    }
    window.addEventListener("load", setup);
})();

/*
 TODO...

 view popped bubbles as table, delete to trash
   see show_popped()
 more colors (fill to side of textarea)
 drag should not select (?)
 stick-to force needs to be symmetrical

 it has frozen up a couple times and you can't select anything
 energy is leaking into the system, causing bubbles to spin instead of settle down (not enough entropy somewhere)
 options panel - friction, all the physics constants, colors, whatever, save them
 gravity and weight could be combined
 optimize - don't paint off-screen stuff
 option to show off-screen bubbles (thin arrows around the edge of the page, possibly with labels)
 stick-to button needs to say 'now click on a bubble'
 surface tension adjustment

 bubbles are still being chased (some were running away)
 hover to see details
 wrap text to bubble?

 JIRA link per bubble

 instructions
   double click to create new bubble
   link to demo mode
 */