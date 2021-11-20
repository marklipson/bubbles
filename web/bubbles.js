/**
 * BUBBLES.
 *
 * Requires utils.js.
 */
(function(){
    // VARIOUS (mostly) PHYSICS SETTINGS & ADJUSTMENTS
    // how hard bubbles push one another away when touching
    let bounce = 0.7;
    // how hard bubbles push one another away when close
    let repulsion = 2;
    // thickness of bubble walls
    let bubble_wall = 5;
    // margin around bubbles
    let bubble_outer_margin = 4;
    // overall reduction of force (needs a better name)
    let inertia = 0.3;
    // stickiness of background - forces less than this will be ignored
    let bg_friction = 0.4;
    // closer to 1: free floating, closer to 0: lots of friction - 'viscosity'?,
    let v_friction = 0.3;
    // how much force the stick-to strings have (higher = tighter)
    let spring_force = 15;
    let spring_damping = 0.4;
    // minimum bubble size
    let min_bubble_r = 15;
    let max_bubble_r = 2000;
    // zoom range
    let min_zoom = 0.08;
    let max_zoom = 9;

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
    // grid styles
    const grid_styles = [
        "grid",
        "polar",
        "spherical",
        "no grid"
    ];
    // friction etc.
    const physics_presets = [
        {name: "friction: low", v_friction: 0.9, bg_friction: 0.1, inertia: 0.2, spring_force: 10, spring_damping: 0.6, bounce: 0.4},
        {name: "friction: med", v_friction: 0.3, bg_friction: 0.4, inertia: 0.3, spring_force: 15, spring_damping: 0.4, bounce: 0.7},
        {name: "friction: high", v_friction: 0.1, bg_friction: 0.7, inertia: 0.2, spring_force: 20, spring_damping: 0.3, bounce: 0.7}
    ];

    // COLORS
    let sel_color = "rgba(255,255,128,128)";  // "#ffff80";
    let bg_color = "#e0e0e0";
    let grid_color = "#c0d0ff";
    let grid_label_color = "#a0b0e8";
    let space_color = "#80a0c0";
    let seek_arrow_color = "#00c000";
    let bubble_opacity = 0.3;

    // MAIN DATA
    // all the bubbles
    let bubbles = [];
    // - index of bubbles by UUID (use add_bubble() & delete_bubble())
    let bubble_index = {};
    // popped bubbles
    let popped = [];
    // title of current page
    let title = "";

    // VIEW STUFF
    // - delay between frames
    let frame_rate = 40;
    // - start time for previous frame
    let t0 = new Date().getTime();
    // - selected grid style
    let show_grid = "grid";
    // - whether to save any bubbles
    let save_popped = true;
    // - player-controlled 'ship'
    let zappo = null;
    // - radius of navigable world
    let world_r = 6000;
    // - current pan & zoom
    let pan = [0, 0];
    let zoom = 1;
    // - keep this bubble centered
    let track_to = null;
    // - mouse metrics
    var mouse_pos = [0, 0];
    var move00 = null, move0 = null, move1 = null;
    // - for detecting clicks related to a bubble, i.e. for stick-to
    let capture_bubble_click = null;
    // - additional plugged-in animations (see frame())
    let animators = [];
    // - canvas & context
    let the_canvas = null;
    let the_context = null;

    //
    function random_color() {
        return r_colors[Math.floor(Math.random()*r_colors.length)];
    }

    /**
     * Remove all bubbles (does not clear the popped bubble list).
     */
    function clear() {
        bubbles = []
        bubble_index = {}
    }

    /**
     * Add a new bubble to the world.
     */
    function add_bubble(bubble) {
        bubbles.push(bubble);
        bubble_index[bubble.uuid] = bubble;
    }

    /**
     * Delete a bubble from the world.
     */
    function delete_bubble(bubble) {
        if (track_to === bubble)
            track_bubble(null);
        for (let nr=0; nr < bubble.refs; nr++) {
            let other = bubble_index[bubble.refs[nr]];
            if (other && other.stick_to && other.stick_to.target === bubble.uuid)
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
        let opt = document.createElement("option");
        opt.innerText = "---";
        opt.setAttribute("value", "");
        save_sel.appendChild(opt);
        for (let n=0; n < saves.length; n++) {
            let opt = document.createElement("option");
            let txt = saves[n];
            if (txt.length > 20)
                txt = txt.substring(0, 20) + "...";
            opt.innerText = txt;
            save_sel.appendChild(opt);
        }
    }

    /**
     * Convert the current page/scene to JSON.
     */
    function _save_data(indent=0) {
        function reduce(src) {
            let b = Object.assign({}, src);
            delete b.squish;
            delete b.selected;
            delete b.dragging;
            b.x = Math.round(b.x*1000) / 1000;
            b.y = Math.round(b.y*1000) / 1000;
            b.r = Math.round(b.r*1000) / 1000;
            delete b.vx;
            delete b.vy;
            delete b.r2;
            delete b.refs;
            delete b.change_size;
            delete b.popping;
            delete b.seek_forces;
            if (! b.stick_to)
                delete b.stick_to;
            if (! b.popped_at)
                delete b.popped_at;
            return b;
        }
        let out = [];
        for (let n=0; n < bubbles.length; n++) {
            const b = bubbles[n];
            if (b.zappo)
                continue
            out.push(reduce(b));
        }
        let out_p = [];
        for (let n=0; n < popped.length; n++)
            out_p.push(reduce(popped[n]));
        const world = {
            v_friction: v_friction, bg_friction: bg_friction, inertia: inertia,
            spring_force: spring_force, spring_damping: spring_damping, bounce: bounce,
            show_grid: show_grid
        }
        return JSON.stringify({"bubbles": out, "popped": out_p, "pan": pan, "zoom": zoom, world: world}, null, indent);
    }
    function save(name="") {
        name = name || title || "default";
        const all = all_saves();
        const data = _save_data();
        localStorage.setItem("save." + name, data);
        // make sure the save is listed
        if (all.indexOf(name) < 0) {
            all.push(name);
            upd_saves(all);
        }
    }
    function load(name="") {
        name = name || "default";
        if (name === title)
            return;
        let raw_data = localStorage.getItem("save." + name);
        _load_data(raw_data, name);
    }
    function _load_data(raw_data, new_title) {
        let data = JSON.parse(raw_data);
        title = new_title;
        if (data === null)
            data = {bubbles: [], popped: []};
        clear();
        let refs = [];
        for (let nb=0; nb < data.bubbles.length; nb++) {
            const b = data.bubbles[nb];
            if (b === null || b.x === null)
                continue;
            const b_new = new Bubble(b.x, b.y, b.r, b.color, b.text, b.fixed, b.weight, b.bounce, b.gravity, b.uuid, b.stick_to);
            b_new.created_at = b.created_at;
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
        // world properties
        if (data.world) {
            if (data.world.v_friction) {
                v_friction = data.world.v_friction;
                // update controls
                const btn_friction = document.getElementById("friction-etc");
                for (let n=0; n < physics_presets.length; n++)
                    if (physics_presets[n].v_friction === v_friction)
                        btn_friction.innerText = physics_presets[n].name;
            }
            if (data.world.bg_friction)
                bg_friction = data.world.bg_friction;
            if (data.world.inertia)
                inertia = data.world.inertia;
            if (data.world.spring_force)
                spring_force = data.world.spring_force;
            if (data.world.spring_damping)
                spring_damping = data.world.spring_damping;
            if (data.world.bounce)
                bounce = data.world.bounce;
            if (data.world.show_grid) {
                show_grid = data.world.show_grid;
                const btn_grid = document.getElementById("show-grid");
                btn_grid.innerText = data.world.show_grid;
            }
        }
        // make it bookmarkable
        window.location.hash = title;
        document.title = title + " - Bubbles";
        // show selection
        const save_sel = document.getElementById("saves");
        if (all_saves().indexOf(title) === -1) {
            save();
            upd_saves();
        }
        save_sel.value = title;
    }
    //
    function stick_bubbles(source, target, length=50) {
        source.stick_to = {target: target.uuid, length: length};
        target.refs.push(source.uuid);
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
     * Representation of a bubble.
     */
    class Bubble {
        constructor(x, y, r, color, text="", fixed=false, weight=1, bounce=1, gravity=0, uuid=null, stick_to=null) {
            // pre-validation
            if (r < min_bubble_r)
                r = min_bubble_r;
            if (r > max_bubble_r)
                r = max_bubble_r;
            // all the persistent properties
            this.x = x;
            this.y = y;
            this.r = r;
            this.uuid = uuid || make_uuid();
            if (typeof(stick_to) == "string")
                stick_to = {target: stick_to, length: 0};
            this.stick_to = stick_to;
            this.color = color;
            this.text = text;
            this.weight = weight;
            this.bounce = bounce;
            this.fixed = fixed;
            this.gravity = gravity;
            this.created_at = new Date().getTime();
            this.popped_at = null;
            // only used for viewing (not persisted)
            // - radii of points on surface (i.e. shape of bubble)
            this.squish = [];
            // 'reverse ip' for bubble references (not persisted)
            this.refs = [];
            // velocity
            this.vx = 0;
            this.vy = 0;
            // for very minor optimization
            this.r2 = r*r;
            // very specific view flags
            this.dragging = false;
            this.selected = false;
            this.change_size = 0;
            this.zappo = null;
            // fills in 'squish'
            this.restore_surface();
        }

        /**
         * Make a copy.
         */
        clone() {
            let out = new Bubble(this.x, this.y, this.r, this.color, this.text, this.fixed, this.weight, this.bounce,
                this.gravity, this.uuid, this.stick_to);
            out.created_at = this.created_at;
            out.popped_at = this.popped_at;
            return out;
        }

        /**
         * Return to being a perfect circle.  We call this at the beginning of force calculation and call poke()
         * to deform the surface.
         */
        restore_surface() {
            const sq = []
            for (var n=0; n < 100; n++)
                sq.push(this.r);
            this.squish = sq;
        }

        /**
         * Deform the surface.  This should only be drawn once per "poking force" per frame.
         *
         * @param depth     Depth of the incursion.
         * @param angle     Central point of (assumed-to-be-spherical) incursion.
         * @param other_d   Distance to poking  object.
         * @param other_r   Radius of poking object.
         */
        poke(depth, angle, other_d, other_r) {
            const npts = this.squish.length;
            const to_n = 6.284 / npts;
            const ai = Math.round(angle / to_n);
            let c = other_r;
            let b = this.r;
            let a = other_d;
            // 'w_poke' is the angular width from the center of incursion to the edge of 'spherical overlap'
            let w_poke = Math.acos((a*a + b*b - c*c) / (2*a*b));
            if (isNaN(w_poke))
                // entirely inside - no point in deformation
                return;
            // limit to deformation
            const max_sq = this.r * 0.70;
            // this method determines how much 'squish' to apply at a given angle
            //  - it is a completely made up formula which looks nice for small pokes but gets really weird for deeper ones
            function f(a) {
                var wx = (a - angle)/w_poke;
                var da = Math.cos(1.57 * wx);
                if (da < 0)
                    da = 0
                var dd = da**0.25 * depth;
                return Math.min(dd, max_sq);
            }
            // decrease radius within the range of spherical overlap
            const nr = Math.floor(w_poke / to_n + 0.5);
            for (var n=ai-nr; n <= ai+nr; n ++) {
                const n1 = (n + npts) % npts;
                this.squish[n1] -= f(n * 6.284 / npts);
            }
        }

        /**
         * Calculate radius of bubble in a given direction (toward a given point).
         */
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

        /**
         * Calculate (x, y) of polar coordinates relative to this bubble.
         */
        polar(a, r) {
            return [
                this.x + Math.cos(a) * r,
                this.y + Math.sin(a) * r
            ];
        }

        /**
         * Compute bubble wall thickness for drawing.  This is currently based on 'weight'.
         */
        wall_width() {
            return bubble_wall * Math.max(0.1, Math.log(4*this.weight));
        }

        /**
         * Point inside bubble.
         */
        inside(x, y) {
            let dx = Math.abs(x - this.x);
            if (dx > this.r)
                return false;
            let dy = Math.abs(y - this.y);
            if (dy > this.r)
                return false;
            let d2 = dx*dx + dy*dy;
            if (d2 > this.r2)
                return false;
            if (Math.sqrt(d2) < this.radius(x, y))
                return true;
        }

        /**
         * Draw this bubble.
         */
        draw(ctx) {
            if (this.zappo) {
                this.draw_zappo(ctx);
                this.draw_selection(ctx);
                return;
            }
            const r = this.r - bubble_outer_margin;
            // stick-to target selection
            const is_click_source = capture_bubble_click  &&  capture_bubble_click.source === this;
            const is_stuck_to = this.stick_to && bubble_index[this.stick_to.target];
            if (is_click_source || is_stuck_to) {
                ctx.lineWidth = 2;
                ctx.beginPath();
                let x0 = this.x, y0 = this.y;
                let x1 = 0, y1 = 0;
                if (is_click_source) {
                    x1 = mouse_pos[0];
                    y1 = mouse_pos[1];
                    ctx.strokeStyle = "red";
                } else {
                    const other = bubble_index[this.stick_to.target];
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
            // seek targets
            if (this.seek_forces) {
                ctx.strokeStyle = seek_arrow_color;
                ctx.lineWidth = 2;
                for (let nb=0; nb < this.seek_forces.length; nb++) {
                    const score = this.seek_forces[nb][0];
                    ctx.lineWidth = score;
                    let b = this.seek_forces[nb][1];
                    let x0 = this.x;
                    let y0 = this.y;
                    let x1 = b.x;
                    let y1 = b.y;
                    // move (x0, y0) to the edge ot the bubble
                    // move (x1, y1) to the edge of the other bubble
                    let r0 = this.radius(x1, y1)
                    let r1 = b.radius(x0, y0);
                    let d = Math.sqrt((x1-x0)**2 + (y1-y0)**2);
                    let r_d0 = r0 / d;
                    x0 += (x1-x0)*r_d0;
                    y0 += (y1-y0)*r_d0;
                    d = Math.sqrt((x1-x0)**2 + (y1-y0)**2);
                    if (r1 > d)
                        r1 = d - 0.1;
                    let r_d1 = r1 / d;
                    x1 -= (x1-x0)*r_d1;
                    y1 -= (y1-y0)*r_d1;
                    d = Math.sqrt((x1-x0)**2 + (y1-y0)**2);
                    let _x = (x1-x0)/d, _y = (y1-y0)/d;
                    ctx.beginPath();
                    ctx.moveTo(x0, y0);
                    ctx.lineTo(x1, y1);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    const arrow_sz = 15;
                    ctx.lineTo(x1 + _x*-arrow_sz + _y*-arrow_sz, y1 + _y*-arrow_sz + _x*arrow_sz );
                    ctx.lineTo(x1 + _x*-arrow_sz + _y*arrow_sz, y1 + _y*-arrow_sz + _x*-arrow_sz );
                    ctx.closePath();
                    ctx.fillStyle = seek_arrow_color;
                    ctx.fill();
                }
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
            ctx.fillStyle = this.color;
            ctx.globalAlpha = bubble_opacity;
            ctx.fill()
            ctx.globalAlpha = 1;
            // draw border
            ctx.lineWidth = this.wall_width();
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
            this.draw_selection(ctx);
            // pointer toward stuck-to bubble
            if (this.stick_to  &&  bubble_index[this.stick_to.target]) {
                const color = bubble_index[this.stick_to.target].color;
                const to_x = bubble_index[this.stick_to.target].x;
                const to_y = bubble_index[this.stick_to.target].y;
                let r = this.radius(to_x, to_y);
                let a = Math.atan2(to_y - this.y, to_x - this.x);
                const px = this.x + r * Math.cos(a);
                const py = this.y + r * Math.sin(a);
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(this.x + r*0.85*Math.cos(a-0.1), this.y + r*0.85*Math.sin(a-0.1));
                ctx.lineTo(this.x + r*0.85*Math.cos(a+0.1), this.y + r*0.85*Math.sin(a+0.1));
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
            }
            // text
            if (true) {
                ctx.textAlign = "center";
                ctx.fillStyle = this.selected ? 'black' : '#404040';
                let margin = 25;
                let draw_text = this.text;
                let lines = draw_text.trim().split("\n");
                let line_height = 16;
                line_height = (this.r / 5);
                if (line_height < 14)
                    line_height = 14;
                if (line_height > 60)
                    line_height = 60;
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

        /**
         * Draw selection graphics.
         */
        draw_selection(ctx) {
            if (! this.selected)
                return;
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

        draw_zappo(ctx) {
            // TODO how about a subclass?
            const z = this.zappo;
            // thrust
            if (z.thrust !== 0) {
                let p0 = this.polar(z.a + 180*Math.PI/180, this.r * 0.5);
                let p1 = this.polar(z.a + 135*Math.PI/180, this.r * 1);
                let p2 = this.polar(z.a + -135*Math.PI/180, this.r * 1);
                ctx.beginPath();
                ctx.moveTo(p2[0], p2[1]);
                ctx.lineTo(p0[0], p0[1]);
                ctx.lineTo(p1[0], p1[1]);
                ctx.arc(this.x, this.y, this.r, z.a + 135*Math.PI/180, z.a + (360-135)*Math.PI/180);
                //ctx.fillStyle = (z.thrust > 0) ? "#f0c080" : "#80e0f0";
                let x=this.x, y=this.y;
                let grd = ctx.createRadialGradient(x, y, this.r/2, x, y, this.r);
                grd.addColorStop(0, (z.thrust > 0) ? "#ff4040" : "#4080f0");
                grd.addColorStop(1, (z.thrust > 0) ? "#ffd0a0" : "#a0e0ff");
                ctx.fillStyle = grd;
                ctx.fill();
            }
            // outline/fill
            ctx.lineWidth = 4;
            ctx.beginPath()
            const pts = [[0, 1], [30, 0.6], [135, 1], [180, 0.5], [-135, 1], [-30, 0.6]];
            for (let n=0; n < pts.length; n++) {
                let pt = pts[n];
                let p = this.polar(z.a + pt[0]*Math.PI/180, pt[1] * this.r);
                if (n === 0)
                    ctx.moveTo(p[0], p[1]);
                else
                    ctx.lineTo(p[0], p[1]);
            }
            ctx.closePath();
            ctx.strokeStyle = this.color;
            ctx.lineJoin = "round";
            ctx.stroke();
            ctx.fillStyle = this.color;
            ctx.globalAlpha = bubble_opacity;
            ctx.fill();
            ctx.globalAlpha = 1;
            // missles
            ctx.lineWidth = 3;
            ctx.strokeStyle = "red";
            ctx.lineCap = "butt";
            for (let n=0; n < this.zappo.missles.length; n++) {
                let m = this.zappo.missles[n];
                ctx.beginPath();
                ctx.moveTo(m.x, m.y);
                ctx.lineTo(m.x + m.dx, m.y + m.dy);
                ctx.stroke();
            }
        }

        /**
         * Calculate forces involving another bubble.  One bubble or another might initiate a force.  For stick-to,
         * for instance, the 'sticker' applies a force to itself and the 'stickee'.  For gravity, bubbles apply their
         * own gravity to self and others, and if both bubbles have gravity two sets of forces are applied.
         *
         * @param dt        Width of time slice.
         * @param b         Other bubble.
         * @param forces    All computed forces get added here.  Map of uuid->[fx, fy].
         */
        force(dt, b, forces) {
            let fx=0, fy=0;
            const a = this;
            if (a === b  ||  b.popping)
                return;
            const dx = b.x - a.x, dy = b.y - a.y;
            const r2 = dx*dx + dy*dy;
            const ab_r2 = a.r2 + b.r2 + 2*a.r*b.r;
            const closeness = r2 - ab_r2;
            const d = Math.sqrt(dx*dx+dy*dy);
            let f_a = 0;
            if (closeness < 0) {
                // bounciness (outward force resisting deformation) - linearly increasing force
                // TODO this isn't quite right - large bubbles with a low pressure (this.bounce) should be more
                //   noticeably different from a well inflated bubble, i.e. when a heavy bubble is at rest on the surface
                //   and gravity is on.
                f_a = Math.sqrt(-closeness) * bounce * this.bounce * dt;
                f_a *= this.r**-0.25;
                add_force(forces, b.uuid, f_a * dx/d, f_a * dy/d)
                // show bounce visually
                const poke_angle = Math.atan2(dy, dx);
                let poke_depth = a.r + b.r - d;
                poke_depth /= 2;
                this.poke(poke_depth, poke_angle, d, b.r);
            } else if (closeness < 10000) {
                // mild repulsion
                f_a = repulsion * dt * 10 / (closeness + 10);
            }
            // stuck to another bubble - follow closely at a prescribed distance
            if (this.stick_to && b.uuid === this.stick_to.target) {
                const stick_to_dist = this.stick_to.length;
                const d_outer = (d - a.r - b.r) - stick_to_dist;
                // linear pressure but fairly strong
                let pressure = spring_force*d_outer * dt;
                if (Math.abs(pressure) > 200)
                    pressure = Math.sign(pressure)*200;
                f_a -= pressure;
                // damping to compensate for pre-existing velocity
                //  - abv is pre-existing velocity
                //  - c_abv is the dot product of velocity and position, i.e. amount of velocity in need of compensation
                let abv = [a.vx - b.vx, a.vy - b.vy];
                let c_abv = abv[0] * dx/d + abv[1] * dy/d;
                if (Math.abs(c_abv) > 40)
                    c_abv = Math.sign(c_abv)*40;
                pressure -= c_abv*spring_damping;
                // apply reciprocal force
                add_force(forces, b.uuid, -pressure * dx/d, -pressure * dy/d)
            }
            // gravity toward other bubble
            else if (b.gravity) {
                // this is NOT an inverse square, which drops off too quickly
                let f_g = -b.gravity * 3 * dt * 0.5**((d-b.r)/500) * Math.sqrt(this.weight);
                // reduce gravity at short range to avoid wiggling
                const d_outer = d - a.r - b.r;
                if (d_outer < 10)
                    f_g /= 1.2;
                if (d_outer < 5)
                    f_g /= 1.2;
                f_a += f_g;
                // reciprocal force
                add_force(forces, b.uuid, f_g*dx/d, f_g*dy/d);
            }
            // give the force (f_a) a direction
            if (f_a && d) {
                fx -= f_a * dx/d;
                fy -= f_a * dy/d;
            }
            add_force(forces, this.uuid, fx, fy);
        }

        /**
         * Forces powering a seek-type bubble.
         */
        seek_force(dt, forces) {
            if (! this.text.startsWith("SEEK:")) {
                this.seek_forces = null;
                return;
            }
            this.seek_forces = [];
            let words = this.text.substring(5).toLowerCase().split(/[^a-zA-Z0-9]+/);
            let found = [];
            let total = 0
            for (var nb=0; nb < bubbles.length; nb++) {
                const b = bubbles[nb];
                if (! b.text  ||  b.popping  ||  b === this)
                    continue;
                let b_words = b.text.toLowerCase().split(/[^a-zA-Z0-9]+/);
                let score = 0;
                for (let na=0; na < words.length; na++)
                    if (b_words.indexOf(words[na]) >= 0)
                        score += 1;
                if (! score)
                    continue;
                this.seek_forces.push([score, b]);
                let dx = b.x - this.x;
                let dy = b.y - this.y;
                let d = Math.sqrt(dx*dx + dy*dy);
                let d_r = (d - b.r - this.r) / d;
                let tx = this.x + d_r * dx;
                let ty = this.y + d_r * dy;
                total += score;
                found.push([score*tx, score*ty]);
            }
            if (found.length > 0) {
                let cx = 0, cy = 0;
                for (let n=0; n < found.length; n++) {
                    cx += found[n][0];
                    cy += found[n][1];
                }
                cx /= total;
                cy /= total;
                let dx = cx - this.x;
                let dy = cy - this.y;
                let d = Math.sqrt(dx*dx + dy*dy);
                const seek_speed = 25;
                let f_seek = seek_speed;
                if (d < 50)
                    f_seek /= 2;
                if (d < 10)
                    f_seek /= 2;
                if (d < 5)
                    f_seek = 0;
                let fx = f_seek * dt * dx/d;
                let fy = f_seek * dt * dy/d;
                add_force(forces, this.uuid, fx, fy);
            }
        }

        /**
         * Compute all forces 'belonging to' this bubble (see force()).
         *
         * In addition to calling force() to compute all forces between bubbles, we manage the
         * bubble shape.  That is, we apply forces relating to the bubble's surface here:
         *   - restore_surface() resets to a circle, then
         *   - we call force(), which calls poke(), which deforms bubbles based on 'incursion'
         */
        compute_forces(dt, forces) {
            if (this.zappo) {
                const a = this.zappo.a;
                if (this.zappo.thrust) {
                    const f = 80 * dt * this.zappo.thrust;
                    add_force(forces, this.uuid, f * Math.cos(a), f * Math.sin(a));
                }
                if (this.zappo.turn) {
                    const da = dt * 1 * this.zappo.turn;
                    this.zappo.a += da;
                }
                // should zappos be immune to gravity & such?
                //return;
            }
            this.restore_surface();
            for (var nb=0; nb < bubbles.length; nb++)
                this.force(dt, bubbles[nb], forces);
            if (this.text.startsWith("SEEK:")) {
                let f0 = forces[this.uuid];
                if (f0) {
                    forces[this.uuid] = [f0[0]/2.5, f0[1]/2.5];
                }
                this.seek_force(dt, forces);
            }
            this.squish = surface_tension(this.squish, 3);
            /*
            // toward center
            const d0 = Math.sqrt(a.x*a.x + a.y*a.y);
            if (to_center && d0 > 30) {
                const f0c = dt * to_center * this.weight;
                fx -= f0c * a.x/d0;
                fy -= f0c * a.y/d0;
            }
            */
        }

        /**
         * Move this bubble based on computed forces.  All forces for all bubbles need to be computed--see frame().
         *
         * @param dt            Width of time slice.
         * @param force         Amount of force being applied.
         * @param friction      Surface friction value which takes 'dt' into account--0 is like floating in space,
         *                      1 allows no drift whatsoever.
         * @param popped        If a bubble needs to be popped for some reason, i.e. if it bumps into something sharp,
         *                      expires, or is struck by something, add it to this list to schedule for popping.
         */
        move(dt, force, friction, popped) {
            if (this.dragging  ||  this.fixed)
                force = [0, 0];
            // the 'paper' prevents any force below a certain level
            // TODO combine fx+fy properly into a vector and use its length - the calculation below is 'square'
            if (Math.abs(force[0]) < bg_friction  &&  Math.abs(force[1]) < bg_friction)
                force = [0, 0];
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
            //
            if (this.zappo) {
                let missles = this.zappo.missles;
                for (let n = 0; n < missles.length; n++) {
                    let m = missles[n];
                    m.x += m.vx * dt;
                    m.y += m.vy * dt;
                    m.t += dt;
                    for (let nb=0; nb < bubbles.length; nb++)
                        if (bubbles[nb] !== this  &&  bubbles[nb].inside(m.x, m.y)) {
                            popped.push(bubbles[nb]);
                            m.t = 999;
                        }
                }
                while (missles.length  &&  missles[0].t > 3) {
                    missles.splice(0, 1);
                }
            }
        }
    }

    /**
     * Draw a graph papery grid.
     */
    function draw_grid() {
        const ctx = the_context;
        if (show_grid === "grid") {
            const w = the_canvas.width / zoom;
            const h = the_canvas.height / zoom;
            let x0 = pan[0] - w / 2;
            let y0 = pan[1] - h / 2;
            const grid_size = 100;
            const n_x = Math.floor(w / grid_size) + 1;
            const n_y = Math.floor(h / grid_size) + 1;
            const gx0 = x0 - x0 % grid_size;
            const gy0 = y0 - y0 % grid_size;
            ctx.fillStyle = grid_color;
            for (let ny = 0; ny < n_y; ny++) {
                const thk = ((gy0 + ny * grid_size) % 1000 === 0) ? 3 : 1
                ctx.fillRect(x0, gy0 + ny * grid_size, w, thk);
            }
            for (let nx = 0; nx < n_x; nx++) {
                const thk = ((gx0 + nx * grid_size) % 1000 === 0) ? 3 : 1
                ctx.fillRect(gx0 + nx * grid_size, y0, thk, h);
            }
        } else if (show_grid === "polar") {
            ctx.strokeStyle = grid_color;
            ctx.fillStyle = grid_label_color;
            ctx.textAlign = "left";
            ctx.font = "18px sans-serif";
            for (let r=200; r < world_r; r += 200) {
                ctx.lineWidth = (r % 1000 === 0) ? 5 : 2;
                ctx.beginPath();
                ctx.ellipse(0, 0, r, r, 0, 0, 6.284);
                ctx.stroke();
                ctx.fillText(r.toString(), 6, -r - 5);
            }
            ctx.lineCap = "butt";
            ctx.textAlign = "center";
            for (let a=0; a < 360; a += 15) {
                ctx.lineWidth = (a % 45 === 0) ? 5 : 2;
                let va = -a * Math.PI / 180;
                ctx.beginPath();
                ctx.moveTo(200*Math.cos(va), 200*Math.sin(va));
                ctx.lineTo(world_r*Math.cos(va), world_r*Math.sin(va));
                ctx.stroke();
                ctx.save();
                if (a > 90 && a < 270) {
                    ctx.translate(500 * Math.cos(va + 0.01), 500 * Math.sin(va + 0.01));
                    ctx.rotate(va + Math.PI);
                } else {
                    ctx.translate(500 * Math.cos(va - 0.01), 500 * Math.sin(va - 0.01));
                    ctx.rotate(va);
                }
                ctx.fillText(a.toString(),0, 0);
                ctx.restore();
            }
        } else if (show_grid === "spherical") {
            ctx.strokeStyle = grid_color;
            ctx.fillStyle = grid_label_color;
            ctx.textAlign = "left";
            ctx.font = "18px sans-serif";
            // latitudes
            for (let a=-80; a <= 80; a += 10) {
                ctx.lineWidth = (a % 30 === 0) ? 6 : 4;
                let alpha = a * Math.PI / 180;
                let y = Math.sin(alpha) * world_r;
                let x = Math.cos(alpha) * world_r;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(-x, y);
                ctx.stroke();
            }
            // longitudes
            for (let b=-90; b <= 90; b += 10) {
                ctx.lineWidth = (b % 30 === 0) ? 6 : 4;
                let beta = b * Math.PI / 180;
                ctx.beginPath();
                for (let a=-90; a <= 90; a += 5) {
                    let alpha = a * Math.PI / 180;
                    let y = Math.sin(alpha) * world_r;
                    let x = Math.sin(beta)*Math.cos(alpha) * world_r;
                    if (a === -90)
                        ctx.moveTo(x, y);
                    else
                        ctx.lineTo(-x, y);
                }
                ctx.stroke();
            }
        }
        // cross-hairs in middle
        const ch_sz = (show_grid === "polar") ? 200 : 100;
        const ch_w = (show_grid === "polar") ? 3 : 2;
        ctx.fillStyle = "darkgray";
        ctx.fillRect(-ch_sz/2, -ch_w/2, ch_sz, ch_w);
        ctx.fillRect(-ch_w/2, -ch_sz/2, ch_w, ch_sz);
    }

    /**
     * Animate popping of a bubble, then delete the bubble.
     */
    function pop_bubble(bubble) {
        if (bubble.popped_at)
            return;
        if (bubble.selected);
            select_bubble(null);
        const ctx = the_context;
        let parts = [];
        const squishlen = bubble.squish.length;
        bubble.popped_at = new Date().getTime();
        if (save_popped  &&  bubble.text)
            popped.push(bubble.clone());
        let step = 5;
        if (bubble.r > 100)
            step = 3;
        if (bubble.r > 200)
            step = 2;
        const avglen = 6.283 * bubble.r * step / squishlen / 2;
        for (let nr=0; nr < squishlen; nr+=step) {
            const a = nr*6.283/squishlen;
            const c = bubble.polar(a, bubble.squish[nr]);
            parts.push({
                x: c[0], y: c[1],
                a: a + 1.57,
                vx: 10*Math.cos(a) + 6*(Math.random() - 0.5), vy: 10*Math.sin(a) + 6*(Math.random() - 0.5),
                da: (Math.random()-0.5)*0.6,
                len: avglen + (Math.random() - 0.5)*avglen*0.8
            })
        }
        let n_frames = 30;
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
                ctx.lineTo(part.x-dx, part.y-dy);
                part.x += part.vx;
                part.y += part.vy;
                part.a += part.da;
            }
            ctx.globalAlpha = ((n_frames-frame)/n_frames);
            ctx.stroke();
            ctx.globalAlpha = 1
            frame ++;
            if (frame >= n_frames) {
                return true;
            }
            return false;
        }
        animators.push(pop_frame);
        delete_bubble(bubble);
    }

    /**
     * Draw each frame!
     */
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
        draw_grid();
        ctx.restore();
        // move & draw bubbles
        const t = new Date().getTime();
        const dt = Math.min(t - t0, 0.1);
        const friction = v_friction**dt;
        t0 = t;
        const forces = {};
        for (let nb=0; nb < bubbles.length; nb++){
            bubbles[nb].compute_forces(dt, forces);
        }
        let popped = [];
        for (let nb=0; nb < bubbles.length; nb++){
            let f = forces[bubbles[nb].uuid];
            if (! f)
                f = [0, 0];
            bubbles[nb].move(dt, f, friction, popped);
            bubbles[nb].draw(ctx);
        }
        // pop bubbles listed by move()
        for (let np=0; np < popped.length; np++) {
            pop_bubble(popped[np]);
        }
        // track-to
        if (track_to) {
            let dx = track_to.x - pan[0];
            let dy = track_to.y - pan[1];
            let z = 0.975 * dt;
            set_pan_zoom(pan[0] + dx * z, pan[1] + dy * z);
            /*
            // indicator of tracking
            let state = (new Date().getTime() % 2500)  < 1250;
            let x = pan[0] - the_canvas.width/2/zoom;
            let y = pan[1] + the_canvas.height/2/zoom;
            ctx.fillStyle = "green";
            ctx.textAlign = "center";
            ctx.font = "20px sans-serif";
            ctx.fillText(state ? "TRACKING" : "tracking", x + 65, y - 20);
            */
        }
        // additional animations
        let remove_anims = [];
        for (let na=0; na < animators.length; na++) {
            let anim = animators[na];
            // call each animator - they return true when they are done
            if (anim(dt))
                remove_anims.push(anim)
        }
        for (let na=0; na < remove_anims.length; na++) {
            animators.splice(animators.indexOf(remove_anims[na]), 1);
        }
    }

    /**
     * Detect whether a given point is over a bubble.  Takes 'squishiness' of bubbles into account, as well as possible
     * overlap of highly compacted bubbles.
     */
    function overbubble(x, y) {
        let best = null;
        let d_best = null;
        for (var nb=0; nb < bubbles.length; nb++) {
            const b = bubbles[nb];
            if (! b.inside(x, y))
                continue;
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

    /**
     * Draw and enable all controls relating to a selected bubble.
     */
    function draw_bubble_form(bubble, area) {
        function refresh() {
            if (! bubble.selected)
                return;
            var h = "";
            h += "<div class='title'>Edit Bubble</div>";
            area.innerHTML = h;
            // edit title
            const edit_text = document.createElement("textarea");
            edit_text.id = "bubble_text_editor";
            edit_text.setAttribute("rows", "3");
            edit_text.value = bubble.text;
            edit_text.addEventListener("input", function() {
                bubble.text = edit_text.value;
            })
            edit_text.addEventListener("focus", function(evt){
                edit_text.style.backgroundColor = "yellow";
                let cycle = 0;
                function flash() {
                    edit_text.style.backgroundColor = (cycle % 2 === 0) ? "yellow" : "";
                    cycle ++;
                    if (cycle <= 5)
                        setTimeout(flash, 250);
                }
                flash();
            });
            area.appendChild(edit_text);
            area.appendChild(document.createElement("br"));
            // color
            choose_color(function(){ return bubble.color; }, function(c){ bubble.color = c; }, area, r_colors);
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
            // bounciness
            edit_value("pressure",function(){ return bubble.bounce; }, function(v){ bubble.bounce = v; }, area, 0.1, 5);
            area.appendChild(document.createElement("br"));
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
            // - stick-to length
            const btn_shorter = document.createElement("button");
            btn_shorter.setAttribute("title", "shorter connector");
            btn_shorter.innerText = "--"
            button_repeater(btn_shorter, function(){
                if (bubble.stick_to)
                    bubble.stick_to.length = Math.max(bubble.stick_to.length - 2, 0);
            }, 40);
            area.appendChild(btn_shorter);
            const btn_longer = document.createElement("button");
            btn_longer.setAttribute("title", "longer connector");
            btn_longer.innerText = "++"
            button_repeater(btn_longer, function(){
                if (bubble.stick_to)
                    bubble.stick_to.length += 2;
            }, 40);
            area.appendChild(btn_longer);
            area.appendChild(document.createElement("br"));
            // pinned
            const btn_pinned = document.createElement("button");
            btn_pinned.setAttribute("title", "When a bubble is 'pinned' it cannot be moved by other bubbles.");
            btn_pinned.innerText = bubble.fixed ? "PINNED" : "   pin   ";
            btn_pinned.addEventListener("click", function() {
                if (bubble.zappo)
                    return;
                bubble.fixed = ! bubble.fixed;
                btn_pinned.innerText = bubble.fixed ? "PINNED" : "   pin   ";
            });
            area.appendChild(btn_pinned);
            // pop bubble
            const btn_pop = document.createElement("button");
            btn_pop.setAttribute("title", "Pop a bubble.  Goodbye, bubble.");
            btn_pop.innerText = "pop"
            btn_pop.addEventListener("click", function() {
                if (bubble.zappo)
                    zappo_mode(false);
                else
                    pop_bubble(bubble);
            });
            area.appendChild(btn_pop);
            // track
            const btn_track = document.createElement("button");
            btn_track.setAttribute("title", "Track this bubble (keep in center).");
            btn_track.innerText = (bubble === track_to) ? "TRACKING" : "track";
            btn_track.addEventListener("click", function() {
                if (btn_track.innerText === "track") {
                    track_bubble(bubble);
                    btn_track.innerText = "TRACKING"
                } else {
                    track_bubble(null);
                    btn_track.innerText = "track"
                }
            });
            area.appendChild(btn_track);
            //
            if (bubble.selected) {
                setTimeout(refresh, 60000);
            }
        }
        refresh();
    }

    /**
     * Track/untrack a bubble.
     */
    function track_bubble(bubble) {
        const show_btn = document.getElementById("show-track-btn");
        const btn = document.getElementById("track");
        if (bubble) {
            show_btn.style.display = "block";
            btn.innerText = "TRACKING"
        } else {
            show_btn.style.display = "none";
            btn.innerText = "track"
        }
        track_to = bubble;
    }

    /**
     * Open or close the pop-up modal dialog and return its area for writing.
     */
    function show_dialog() {
        const dlg_frame = document.getElementById("dialog-frame");
        const dlg_body = document.getElementById("dialog-body");
        const dlg_closer = document.getElementById("dialog-close");
        dlg_frame.style.display = dlg_body.style.display = "block";
        function closer() {
            dlg_frame.style.display = dlg_body.style.display = "none";
            dlg_closer.removeEventListener("click", closer);
            dlg_body.innerText = "";
        }
        dlg_closer.addEventListener("click", closer);
        // TODO Esc to close
        return [dlg_body, closer];
    }

    /**
     * Display all popped bubbles in a table.
     */
    function show_bubble_list(which="popped") {
        const area_closer = show_dialog();
        const area = area_closer[0];
        const dlg_closer = area_closer[1];
        const source = (which === "popped") ? popped : bubbles;
        const bubble_list = source.slice();
        const table = document.createElement("table");
        area.appendChild(table);
        const hdrs = document.createElement("tr");
        hdrs.style.position = "sticky";
        hdrs.style.top = "0";
        table.appendChild(hdrs);
        const cols = ["", "color", "text", "x", "y", "r", "created_at"];
        if (which === "popped")
            cols.push("popped_at");
        function link_action(add_to, text, action, tooltip) {
            const link = document.createElement("div");
            link.className = "small-link";
            link.setAttribute("title", tooltip);
            link.innerText = text;
            link.addEventListener("click", action);
            add_to.appendChild(link);
        }
        function visit_bubble_checkboxes(visitor) {
            for (let n=0; n < bubble_list.length; n++) {
                let cb = document.getElementById("sel-" + n);
                if (cb)
                    visitor(cb, bubble_list[n]);
            }
        }
        function remove_bubble_row(cb, bubble) {
            let idx = source.indexOf(bubble);
            if (idx >= 0) {
                if (which === "popped")
                    // permanent deletion
                    source.splice(idx, 1);
                else
                    // pop
                    pop_bubble(bubble);
            }
            let row = cb.parentElement.parentElement;
            row.parentElement.removeChild(row);
        }
        for (let n=0; n < cols.length; n++) {
            let cell = document.createElement("th");
            cell.innerText = cols[n];
            if (cols[n] === "") {
                link_action(cell, "all", function () {
                    visit_bubble_checkboxes(function (cb, bubble) {
                        cb.checked = true;
                    });
                }, "Select all bubbles in this list.");
                link_action(cell, "none", function () {
                    visit_bubble_checkboxes(function (cb, bubble) {
                        cb.checked = false;
                    });
                }, "Un-select all bubbles in this list.");
                link_action(cell, (which === "popped") ? "delete" : "pop", function () {
                    visit_bubble_checkboxes(function (cb, bubble) {
                        if (!cb.checked)
                            return;
                        remove_bubble_row(cb, bubble);
                    });
                }, (which === "popped") ? "Permanently delete checked bubbles." : "Pop checked bubbles.");
                if (which === "popped") {
                    link_action(cell, "undelete", function () {
                        visit_bubble_checkboxes(function (cb, bubble) {
                            if (!cb.checked)
                                return;
                            let bbl = new Bubble(bubble.x, bubble.y, bubble.r, bubble.color, bubble.text, bubble.fixed, bubble.weight, bubble.bounce, bubble.gravity, bubble.uuid, bubble.stick_to);
                            bbl.created_at = bubble.created_at;
                            add_bubble(bbl);
                            remove_bubble_row(cb, bubble);
                        });
                    }, "Un-pop checked bubbles.");
                } else {
                    link_action(cell, "go to", function () {
                        let ul = null, lr = null;
                        visit_bubble_checkboxes(function (cb, bubble) {
                            if (!cb.checked)
                                return;
                            const b_ul = [bubble.x - bubble.r, bubble.y - bubble.r];
                            const b_lr = [bubble.x + bubble.r, bubble.y + bubble.r];
                            if (!ul)
                                ul = b_ul;
                            else
                                ul = [Math.min(ul[0], b_ul[0]), Math.min(ul[1], b_ul[1])]
                            if (!lr)
                                lr = b_lr;
                            else
                                lr = [Math.max(lr[0], b_lr[0]), Math.max(lr[1], b_lr[1])]
                        }, "Show checked bubbles.");
                        if (ul) {
                            // calculate zoom
                            let zx = 0.5 * the_canvas.width / (lr[0] - ul[0]);
                            let zy = 0.5 * the_canvas.height / (lr[1] - ul[1]);
                            let z = Math.min(zx, zy);
                            if (z < min_zoom)
                                z = min_zoom;
                            if (z > max_zoom)
                                z = Math.min(max_zoom, 1);
                            // set pan/zoom to focus on selected bubbles
                            set_pan_zoom((ul[0] + lr[0]) / 2, (ul[1] + lr[1]) / 2, z);
                            // hide list dialog
                            dlg_closer();
                        }
                    });
                }
            } else {
                // sortable column
                cell.addEventListener("click", function(evt){
                    let cell_index = 1;
                    for (let cell=evt.target; cell.previousElementSibling; cell = cell.previousElementSibling)
                        cell_index ++;
                    let rows = [];
                    table.querySelectorAll("tr.data-row").forEach((tr)=>{rows.push(tr)});
                    // choose column / toggle direction
                    let direction = cell.classList.contains("ascending") ? -1 : 1;
                    table.querySelectorAll("th").forEach((th)=>{
                        th.classList.remove("ascending");
                        th.classList.remove("descending");
                    });
                    cell.classList.add((direction === 1) ? "ascending" : "descending");
                    function to_float(v) {
                        if (! v)
                            return v;
                        let vf = parseFloat(v);
                        return isNaN(vf) ? v : vf;
                    }
                    rows.sort(function(a, b){
                        let cell_l = a.querySelector("td:nth-child(" + cell_index + ")");
                        let cell_r = b.querySelector("td:nth-child(" + cell_index + ")");
                        let v_l = cell_l.getAttribute("data-sortvalue") || cell_l.innerText;
                        let v_r = cell_r.getAttribute("data-sortvalue") || cell_r.innerText;
                        let vn_l = to_float(v_l);
                        let vn_r = to_float(v_r);
                        if (typeof(vn_l) != "string"  &&  typeof(vn_r) != "string") {
                            v_l = vn_l;
                            v_r = vn_r;
                        }
                        if (v_l === v_r)
                            return 0;
                        if (v_l < v_r)
                            return -direction;
                        return direction;
                    });
                    for (let n=0; n < rows.length; n++) {
                        table.removeChild(rows[n]);
                        table.appendChild(rows[n]);
                    }
                });
            }
            hdrs.appendChild(cell);
        }
        for (let n=0; n < bubble_list.length; n++) {
            const bubble = bubble_list[n];
            const row = document.createElement("tr");
            row.className = "data-row"
            table.appendChild(row);
            for (let nc=0; nc < cols.length; nc++) {
                let cell = document.createElement("td");
                if (cols[nc] === "")
                    cell.innerHTML = "<input type='checkbox' id='sel-" + n + "'/>";
                else {
                    let v = bubble[cols[nc]] || "";
                    if (cols[nc].endsWith("_at")) {
                        v = new Date(v);
                        const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                        v = mo[v.getMonth()] + " " + v.getDay() + ", " + v.getHours() + ":" + Math.floor(v.getMinutes()/10) + v.getMinutes()%10;
                        cell.innerText = v;
                    } else if (cols[nc] === "color") {
                        const colorSample = document.createElement("div");
                        const v2 = color_name_to_rgba(v);
                        colorSample.setAttribute("title", v);
                        cell.setAttribute("data-sortvalue", rgb_to_hue(v2));
                        colorSample.style.border = "solid 2px black";
                        colorSample.style.borderRadius = "8px";
                        colorSample.style.display = "inline-block";
                        colorSample.style.width = colorSample.style.height = "12px";
                        colorSample.style.borderColor = v;
                        colorSample.style.backgroundColor = "rgba(" + v2[0] + "," + v2[1] + "," + v2[2] + "," + bubble_opacity + ")";
                        cell.appendChild(colorSample);
                        cell.style.textAlign = "center";
                    } else {
                        if (typeof(v) == "number"  &&  isFinite(v)) {
                            v = v.toFixed(1);
                            cell.style.textAlign = "right";
                        }
                        cell.innerText = v;
                    }
                }
                row.appendChild(cell);
            }
        }
        if (bubble_list.length === 0) {
            const empty_msg = document.createElement("tr");
            empty_msg.innerHTML = "<td class='no-bubbles-in-list' colspan='" + cols.length + "'>-- there are no bubbles in this list --</td>";
            table.appendChild(empty_msg)
        }
    }

    /**
     * Enable bubble drag, select, pan, zoom, etc..
     */
    function drag_and_select() {
        const canvas = the_canvas
        var onbubble = null;
        var start = null;
        var pan0 = null;
        var clicked = false;
        var panel = document.getElementById("panel");
        // set up tools
        function change_zoom(by, steps) {
            if (zoom*by < min_zoom && by < 1)
                by = min_zoom / zoom;
            if (zoom * by > max_zoom &&  by > 1)
                by = max_zoom / zoom;
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
        const save_sel = document.getElementById("saves");
        function rename(new_title) {
            const saves = all_saves();
            if (saves.indexOf(new_title) >= 0) {
                // warn on overwrite
                if (! confirm("Are you sure you want to replace '" + new_title + "'?"))
                    return;
            }
            // change title, rename saved data
            title = new_title;
            let n = saves.indexOf(title);
            if (n >= 0)
                saves.splice(n, 1);
            saves.push(title);
            upd_saves(saves);
            // save right away
            save();
            // select in drop-down
            save_sel.value = title;
            // bookmarkable
            window.location.hash = title;
            document.title = title + " - Bubbles";
        }
        const btn_rename = document.getElementById("rename-file");
        btn_rename.addEventListener("click", function(){
            const new_title = prompt("Rename", title);
            if (new_title  &&  new_title !== title) {
                rename(new_title)
            }
        });
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
            save(title);
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
        btn_grid.addEventListener("click", function(evt){
            let n_style = (grid_styles.indexOf(evt.target.innerText) + 1) % grid_styles.length;
            show_grid = grid_styles[n_style];
            evt.target.innerText = show_grid;
        });
        // un-track
        const btn_track = document.getElementById("track");
        btn_track.addEventListener("click", function() {
            track_bubble(null);
        });
        //
        function to_ctx_coords(evt) {
            const w = the_canvas.width;
            const h = the_canvas.height;
            return [(evt.offsetX - w/2)/zoom + pan[0], (evt.offsetY - h/2)/zoom + pan[1]];
        }
        function create_bubble(at) {
            const c = random_color();
            const bubble = new Bubble(at[0], at[1], 50, c);
            add_bubble(bubble);
            select_bubble(bubble);
            // focus on text editor
            document.getElementById("bubble_text_editor").focus();
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
    }

    /**
     * Choose one bubble and show controls to modify it.
     */
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

    /**
     * Add a random bubble near the center (used for demo mode).
     */
    function add_random_bubble() {
        var px = Math.random()*900 - 450;
        var py = Math.random()*900 - 450;
        var r = Math.random()*80 + 20;
        var c = random_color();
        add_bubble(new Bubble(px, py, r, c, ''));
    }

    /**
     * Support file drop.
     */
    function file_drop(target) {
        // if you don't intercept 'dragover', 'drop' doesn't seem to fire
        target.addEventListener('dragover', function(evt) {
            evt.stopPropagation();
            evt.preventDefault();
            // rumored to do something cool in Chrome
            evt.dataTransfer.dropEffect = 'copy';
        });
        // file dropped...
        target.addEventListener("drop", function(evt) {
            evt.stopPropagation();
            evt.preventDefault();
            let files = evt.dataTransfer.files; // Array of all files
            for (let n=0; n < files.length; n++) {
                // TODO do something reasonable if multiple files are dropped
                let file = files[n];
                var reader = new FileReader();
                reader.onload = function(e_done) {
                    let raw_data = e_done.target.result;
                    _load_data(raw_data, file.name.replace(/\.(json|bubbles)$/, ""))
                }
                reader.readAsText(file);
            }
        });
    }

    /**
     * Turn the zappo blaster on or off.
     */
    function zappo_mode(on) {
        if (on) {
            if (zappo)
                return;
            zappo = new Bubble(pan[0], pan[1], 70, random_color(), "");
            zappo.weight = 0.2;
            zappo.zappo = {
                a: -Math.PI/2,
                thrust: 0,
                turn: 0,
                missles: []
            }
            bubbles.push(zappo);
            track_to = zappo;
            document.addEventListener("keydown", zappo_keys);
            document.addEventListener("keyup", zappo_keys);
        } else {
            if (! zappo)
                return;
            const n = bubbles.indexOf(zappo);
            if (n >= 0)
                bubbles.splice(n);
            if (track_to === zappo)
                track_to = null;
            zappo = null;
            document.removeEventListener("keydown", zappo_keys);
            document.removeEventListener("keyup", zappo_keys);
        }
    }

    /**
     * Handle key events for the zappo blaster.
     */
    function zappo_keys(evt) {
        if (! zappo)
            return;
        const on = evt.type === "keydown";
        if (evt.code === "KeyW"  ||  evt.code === "ArrowUp") {
            zappo.zappo.thrust = on ? 1 : 0;
        } else if (evt.code === "KeyA"  ||  evt.code === "ArrowLeft") {
            zappo.zappo.turn = on ? -1 : 0;
        } else if (evt.code === "KeyS"  ||  evt.code === "ArrowDown") {
            zappo.zappo.thrust = on ? -1 : 0;
        } else if (evt.code === "KeyD"  ||  evt.code === "ArrowRight") {
            zappo.zappo.turn = on ? 1 : 0;
        } else if (evt.code === "Space"  &&  on) {
            let dx = Math.cos(zappo.zappo.a);
            let dy = Math.sin(zappo.zappo.a);
            let x = zappo.x + dx * zappo.r;
            let y = zappo.y + dy * zappo.r;
            zappo.zappo.missles.push({
                x: x,
                y: y,
                dx: dx * 10,
                dy: dy * 10,
                vx: dx * 160,
                vy: dy * 160,
                t: 0
            });
        }
        evt.stopPropagation();
        evt.preventDefault();
    }

    /**
     * Entry point!
     */
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
        set_pan_zoom(pan[0], pan[1], zoom);
        // start bubble animations
        setInterval(function(){ frame(); }, frame_rate);
        // make bubbles draggable
        drag_and_select();
        // resize
        window.addEventListener("resize", function(evt) {
            the_canvas.width = window.innerWidth;
            the_canvas.height = window.innerHeight;
            the_context = the_canvas.getContext('2d');
            set_pan_zoom(pan[0], pan[1], zoom);
            frame();
        })
        // etc
        document.getElementById("show-list").addEventListener("click", ()=>show_bubble_list("main"));
        document.getElementById("show-popped").addEventListener("click", ()=>show_bubble_list("popped"));
        document.getElementById("download").addEventListener("click", function(evt){
            let data = _save_data(2);
            let link = document.createElement("a");
            link.setAttribute("href", "data:application/json;base64," + btoa(data));
            link.setAttribute("download", title + ".bubbles");
            link.setAttribute("target", "_blank");
            link.click();
        });
        document.getElementById("search").addEventListener("click", function(evt){
            const bubble = new Bubble(pan[0], pan[1], 50, "green");
            bubble.text = "SEEK: ";
            track_bubble(bubble);
            bubbles.push(bubble);
            // focus on it
            select_bubble(bubble);
            document.getElementById("bubble_text_editor").focus();
        });
        document.getElementById("friction-etc").addEventListener("click", function(evt){
            // click through presets
            for (let n=0; n < physics_presets.length; n++) {
                if (evt.target.innerText === physics_presets[n].name) {
                    const preset = physics_presets[(n + 1) % physics_presets.length];
                    evt.target.innerText = preset.name;
                    v_friction = preset.v_friction;
                    bg_friction = preset.bg_friction;
                    inertia = preset.inertia;
                    break;
                }
            }
        });
        const btn_zappo = document.getElementById("zappo");
        btn_zappo.addEventListener("click", function() {
            let on = btn_zappo.innerText === "ZAPPO";
            on = ! on;
            btn_zappo.innerText = on ? "ZAPPO" : "zappo";
            btn_zappo.style.backgroundColor = on ? "yellow" : "";
            zappo_mode(on);
        });
        file_drop(the_canvas);
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

    // connect entry point
    window.addEventListener("load", setup);
})();

/*
 TODO...

  subclass Bubble to support different shapes
  barriers (chunky lines that block bubbles)
  modularize this code a bit
  commands in a bubble to, for instance, move toward a given spot over a certain amount of time (i.e. priority increasing toward the deadline)

  hard to throw bubble when zoomed out

  data gets corrupted when you open the same page in two different browser tabs
    localStorage += tabs={my_random_id: page, ...} - don't allow two tabs to open the same page

  bulk 'rectangle' select - Shift+drag - move/pop/etc a group of bubbles

  hover to see details
  wrap text to bubble?

  scroll gestures
  demo mode
 */